import { z } from 'zod';
import { Tool } from '../../types';
import { toolRegistry } from '../../tools/registry';
import path from 'path';

const ConsultParams = z.object({
  query: z.string().min(1).describe('The analytical question or task (e.g., "How should I design this A/B test?", "Look for anomalies in my body battery data").'),
});

export const dataAnalysisConsult: Tool<typeof ConsultParams> = {
  name: 'data_analysis_consult',
  description: 'Consult the internal Data Analysis expert for methodology, chart selection, and statistical rigor. Use this before performing complex data tasks.',
  parameters: ConsultParams,
  execute: async ({ query }: { query: string }) => {
    const skillDir = path.join(process.cwd(), 'src', 'skills', 'data-analysis');
    return { 
      success: true, 
      result: `Consulting data analysis methodology for: "${query}". 
      
Please read the following reference files to ensure analytical rigor:
1. ${path.join(skillDir, 'SKILL.md')} - Core principles and output standards.
2. ${path.join(skillDir, 'techniques.md')} - Method selection (Hypothesis, Cohort, Anomaly, etc.).
3. ${path.join(skillDir, 'chart-selection.md')} - Choosing the right visual.

After reading, proceed with the analysis using Python or code execution, ensuring you lead with the insight and quantify uncertainty.`
    };
  },
};

toolRegistry.register(dataAnalysisConsult);
