import fs from 'fs';
import path from 'path';

interface PairingStoreData {
  authorizedTelegramUsers: string[];
}

function getPairingStoreFilePath(): string {
  return process.env.OPENMAC_PAIRING_STORE_PATH?.trim() || path.join(process.cwd(), 'data', 'telegram-pairings.json');
}

function loadData(): PairingStoreData {
  try {
    const raw = fs.readFileSync(getPairingStoreFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as PairingStoreData;
    return {
      authorizedTelegramUsers: Array.isArray(parsed.authorizedTelegramUsers) ? parsed.authorizedTelegramUsers.map(String) : [],
    };
  } catch {
    return { authorizedTelegramUsers: [] };
  }
}

function saveData(data: PairingStoreData): void {
  const filePath = getPairingStoreFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function getPairingStorePath(): string {
  return getPairingStoreFilePath();
}

export function isTelegramUserPaired(userId: string): boolean {
  return loadData().authorizedTelegramUsers.includes(String(userId));
}

export function approveTelegramUser(userId: string): void {
  const data = loadData();
  const normalized = String(userId);
  if (!data.authorizedTelegramUsers.includes(normalized)) {
    data.authorizedTelegramUsers.push(normalized);
    saveData(data);
  }
}
