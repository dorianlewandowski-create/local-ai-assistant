export async function runUpdateHelp(write: (line: string) => void = console.log): Promise<number> {
  write('OpenMac Update');
  write('Recommended manual update flow:');
  write('1. git pull');
  write('2. npm install');
  write('3. npm run test');
  write('4. npm run build');
  write('5. npm run doctor');
  write('6. restart the resident process or reload launchd');
  return 0;
}
