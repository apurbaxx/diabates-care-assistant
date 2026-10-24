/** Original report attachments stay in the browser; structured records remain in the existing Zustand store. */
function openReports(): Promise<IDBDatabase> {
 return new Promise((resolve,reject)=>{const request=indexedDB.open("cliniq-report-files",1);request.onupgradeneeded=()=>request.result.createObjectStore("files",{keyPath:"id"});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
export async function saveReportFile(id:string,patientId:string,file:Blob,name:string) {
 const db=await openReports();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction("files","readwrite");tx.objectStore("files").put({id,patientId,file,name});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function downloadReportFile(id:string,patientId:string) {
 const db=await openReports();try{const record=await new Promise<{patientId:string;file:Blob;name:string}|undefined>((resolve,reject)=>{const r=db.transaction("files").objectStore("files").get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(!record || record.patientId!==patientId)throw new Error("No original attachment stored for this report");const url=URL.createObjectURL(record.file);const a=document.createElement("a");a.href=url;a.download=record.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}finally{db.close();}
}
