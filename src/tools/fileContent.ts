import fs from 'fs/promises';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { vectorStore } from '../db/vectorStore';
import { config } from '../config';
import { ollamaVisionProvider } from '../models/ollama';

const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.md', '.js', '.ts', '.json']);
const IMAGE_FILE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const VISION_MODEL = config.models.vision;
const MAX_TEXT_PREVIEW_LENGTH = 12000;

function summariseExtractedText(filePath: string, text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return `No readable text content was extracted from ${filePath}.`;
  }

  const preview = trimmed.slice(0, MAX_TEXT_PREVIEW_LENGTH);
  const suffix = trimmed.length > MAX_TEXT_PREVIEW_LENGTH ? ' ...[truncated]' : '';
  return `Content summary for ${filePath}: ${preview}${suffix}`;
}

const ReadTextFileParams = z.object({
  path: z.string().describe('Absolute or relative path to a UTF-8 text file. Supported extensions: .txt, .md, .js, .ts, .json.'),
});

export const readTextFile: Tool<typeof ReadTextFileParams> = {
  name: 'read_text_file',
  description: 'Read plain text-based files such as txt, md, js, ts, and json and return a string summary of the contents.',
  parameters: ReadTextFileParams,
  execute: async ({ path: filePath }) => {
    try {
      const extension = path.extname(filePath).toLowerCase();
      if (!TEXT_FILE_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported text file extension: ${extension || 'none'}. Use this tool only for .txt, .md, .js, .ts, or .json files.`);
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const summary = summariseExtractedText(filePath, content);
      await vectorStore.store({
        source: filePath,
        scope: 'file',
        content,
        metadata: { type: 'text', extension },
      });
      return {
        success: true,
        summary,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const ReadPdfContentParams = z.object({
  path: z.string().describe('Absolute or relative path to a PDF document that should be parsed for text content.'),
});

export const readPdfContent: Tool<typeof ReadPdfContentParams> = {
  name: 'read_pdf_content',
  description: 'Extract raw text from a PDF document and return a string summary that can be used for reflection and follow-up actions.',
  parameters: ReadPdfContentParams,
  execute: async ({ path: filePath }) => {
    let parser: PDFParse | null = null;

    try {
      if (path.extname(filePath).toLowerCase() !== '.pdf') {
        throw new Error('Unsupported file type. Use read_pdf_content only for .pdf files.');
      }

      const dataBuffer = await fs.readFile(filePath);
      parser = new PDFParse({ data: dataBuffer });
      const parsed = await parser.getText();
      const summary = summariseExtractedText(filePath, parsed.text);
      await vectorStore.store({
        source: filePath,
        scope: 'file',
        content: parsed.text,
        metadata: { type: 'pdf' },
      });
      return {
        success: true,
        summary,
      };
    } catch (error: any) {
      const message = error?.message || 'Unknown PDF parsing failure.';
      const friendlyMessage = /encrypted|password|invalid|corrupt|bad xref|format error/i.test(message)
        ? `Unable to extract PDF text from ${filePath}: the document may be encrypted, corrupted, or malformed. Raw error: ${message}`
        : `Unable to extract PDF text from ${filePath}. Raw error: ${message}`;

      return { success: false, error: friendlyMessage };
    } finally {
      await parser?.destroy();
    }
  },
};

const AnalyzeImageContentParams = z.object({
  path: z.string().describe('Absolute or relative path to an image file. Supported extensions: .jpg, .jpeg, .png.'),
  prompt: z.string().optional().describe('Optional analysis goal for the vision model, such as describe the scene, extract text, or identify important objects.'),
});

export const analyzeImageContent: Tool<typeof AnalyzeImageContentParams> = {
  name: 'analyze_image_content',
  description: 'Send an image to a vision-capable Ollama model and return a string summary describing the image contents.',
  parameters: AnalyzeImageContentParams,
  execute: async ({ path: filePath, prompt }) => {
    try {
      const extension = path.extname(filePath).toLowerCase();
      if (!IMAGE_FILE_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported image extension: ${extension || 'none'}. Use this tool only for .jpg, .jpeg, or .png files.`);
      }

      await fs.access(filePath);
      const description = await ollamaVisionProvider.analyzeImage(
        VISION_MODEL,
        filePath,
        prompt || 'Describe this image in a concise but useful way for an autonomous desktop agent. Mention notable objects, visible text, document type, and anything action-worthy.'
      );
      const summary = description ? `Image analysis for ${filePath}: ${description}` : `Image analysis for ${filePath}: the vision model returned an empty description.`;
      await vectorStore.store({
        source: filePath,
        scope: 'file',
        content: summary,
        metadata: { type: 'image', model: VISION_MODEL },
      });
      return {
        success: true,
        summary,
      };
    } catch (error: any) {
      return { success: false, error: `Unable to analyze image ${filePath}. Raw error: ${error.message}` };
    }
  },
};

toolRegistry.register(readTextFile);
toolRegistry.register(readPdfContent);
toolRegistry.register(analyzeImageContent);
