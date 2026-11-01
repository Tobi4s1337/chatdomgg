import {readFile,readdir,rename,writeFile} from 'node:fs/promises';
/** The current file must match its immutable artifact manifest. */
export function canResume(records, {path, key, sourceHash, imageHash}) {
  const current = records.findLast(record => record.path === path);
  return !!current && current.key === key && current.sourceHash === sourceHash
    && typeof imageHash === 'string' && current.imageHash === imageHash;
}
export async function readCaptureRecords(directory) {
  const names=(await readdir(directory)).filter(name=>name.endsWith('.png.json')).sort();
  const records=await Promise.all(names.map(name=>readFile(`${directory}/${name}`,'utf8').then(JSON.parse)));
  return records.sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
}
export async function publishCaptureRecord(record) {
  const destination=record.path+'.json', pending=destination+'.pending';
  await writeFile(pending,JSON.stringify(record)+'\n',{flag:'wx'});
  await rename(pending,destination);
}
