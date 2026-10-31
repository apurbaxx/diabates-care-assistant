const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultNavigationTimeout(120000);page.setDefaultTimeout(45000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let knowledgeRequests=0;page.on('request',r=>{if(r.url().includes('/api/knowledge-assistant/search'))knowledgeRequests++;});
  await page.addInitScript(()=>localStorage.setItem('cliniq:workspace-tour:v1','seen'));
  const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
  await page.goto(base);await page.getByRole('heading',{name:'Doctor workspace'}).waitFor();
  const ids=await page.evaluate(()=>{
   const saved=JSON.parse(localStorage.getItem('diabetes-care-assistant-store'));
   const p=saved.state.patients.find(p=>p.name==='Ahmed Hassan');p.visits.at(-1).clinicianNote='Patient reports tingling in a clinician note.';
   localStorage.setItem('diabetes-care-assistant-store',JSON.stringify(saved));return {patient:p.id,other:saved.state.patients.find(other=>other.id!==p.id).id};
  });
  const warning=page.getByRole('dialog',{name:'Patient record assistant disclaimer'});
  const launcher=page.locator('#assistant').getByRole('button',{name:'Ask Question related to patient records',exact:true});
  async function openAssistant(){await launcher.click();await warning.waitFor();assert.match(await warning.innerText(),/does not provide clinical decisions/);assert.equal(await page.getByLabel('Question about patient record').count(),0);await warning.getByRole('button',{name:'I understand — continue',exact:true}).click();}
  await page.goto(`${base}/patient/${ids.patient}#assistant`);
  await launcher.waitFor();
  assert.equal(await page.getByRole('button',{name:'Ask Question related to patient records',exact:true}).count(),2,'Both bottom and sidebar assistants remain available');
  assert(await page.locator('#assistant').evaluate(el=>el.parentElement.lastElementChild===el),'AI Assistant remains the last patient record section');
  await launcher.click();await warning.waitFor();await warning.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.getByLabel('Question about patient record').count(),0);
  await launcher.click();await warning.waitFor();await page.keyboard.press('Escape');await warning.waitFor({state:'hidden'});assert.equal(await page.getByLabel('Question about patient record').count(),0);
  await openAssistant();await page.reload();await launcher.waitFor();assert.equal(await page.getByLabel('Question about patient record').count(),0);await openAssistant();
  const panel=page.getByTestId('patient-assistant');await panel.getByRole('heading',{name:/Ask about Ahmed/}).waitFor();
  async function ask(question){await panel.getByLabel('Question about patient record').fill(question);await panel.getByRole('button',{name:'Ask patient assistant',exact:true}).click();await panel.getByText(`You asked: ${question}`,{exact:true}).first().waitFor();return panel.getByRole('article',{name:'Patient record answer'}).first();}
  const first=await ask('Show HbA1c over the last six months');assert.match(await first.innerText(),/HbA1c/);assert(await first.getByRole('button',{name:/Show source/}).count()>0);
  await first.getByRole('button',{name:/Show source/}).first().click();await page.getByRole('heading',{name:'Patient record source',exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  const follow=await ask('Only the last month');assert.match(await follow.innerText(),/HbA1c/);assert(!(await follow.innerText()).includes('No active medication'));
  const neutral=await ask('Is this bad?');assert.match(await neutral.innerText(),/do not determine diagnoses/);
  const notes=await ask('Search notes for tingling');assert.match(await notes.innerText(),/Matching clinician note/);await notes.getByRole('button',{name:/Show source/}).first().click();await page.locator('.record-evidence').getByText('Patient reports tingling in a clinician note.',{exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(knowledgeRequests,0,'Patient assistant never queries the PDF assistant');
  const invalid=await page.request.post(`${base}/api/assistant`,{data:{answer:{patientFindings:[{text:'Invented'}]}}});assert.equal(invalid.status(),400);
  const crossPatient=await page.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('diabetes-care-assistant-store'));const p=s.state.patients[0];p.visits[0].patientId='other';return fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({patient:p,question:'Show HbA1c',asOf:new Date().toISOString().slice(0,10)})}).then(r=>r.status);});assert.equal(crossPatient,400);
  // A changed browser record invalidates conversation and any cached answer.
  await page.evaluate(id=>{const saved=JSON.parse(localStorage.getItem('diabetes-care-assistant-store'));saved.state.patients.find(p=>p.id===id).visits.at(-1).labs.hba1c=11.7;const value=JSON.stringify(saved);localStorage.setItem('diabetes-care-assistant-store',value);window.dispatchEvent(new StorageEvent('storage',{key:'diabetes-care-assistant-store',newValue:value}));},ids.patient);
  await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Patient record answer"]').length===0);
  const updated=await ask('Show HbA1c');assert.match(await updated.innerText(),/11.7/);
  await page.evaluate(id=>{
   const saved=JSON.parse(localStorage.getItem('diabetes-care-assistant-store'));const p=saved.state.patients.find(p=>p.id===id);const d=new Date();const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
   p.labReports.push({id:'assistant-integration',patientId:id,date,source:'manual',fileName:'Assistant integration report',rawText:'HbA1c: 10.9 %',values:[{key:'hba1c',value:10.9,reportedValue:10.9,reportedUnit:'%',confidence:1}],unmatchedLines:[],acknowledged:false});localStorage.setItem('diabetes-care-assistant-store',JSON.stringify(saved));
  },ids.patient);
  await page.goto(`${base}/patient/${ids.patient}?report=assistant-integration#labs`);
  await openAssistant();
  const verification=page.getByLabel('Report verification');await verification.getByRole('heading',{name:'Assistant integration report',exact:true}).waitFor();
  const pending=await ask('Show HbA1c');assert(!(await pending.innerText()).includes('10.9'));assert.match(await pending.innerText(),/await verification/);
  await verification.getByRole('button',{name:'Confirm & add to patient record',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Patient record answer"]').length===0);
  const committed=await ask('Show HbA1c');assert.match(await committed.innerText(),/10.9/);assert(await committed.getByRole('link',{name:'Open report',exact:true}).count()>0);
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>{const p=document.querySelector('[data-testid="patient-assistant"]');return p && p.getBoundingClientRect().right<=innerWidth && p.scrollWidth<=p.clientWidth;});
  // Hold a response while navigating to another patient; the old answer must not leak.
  await page.route('**/api/assistant',async route=>{await new Promise(resolve=>setTimeout(resolve,800));try{await route.continue();}catch{}});
  await panel.getByLabel('Question about patient record').fill('Show HbA1c over the last six months');await panel.getByRole('button',{name:'Ask patient assistant',exact:true}).click();
  await page.goto(`${base}/patient/${ids.other}#assistant`);await openAssistant();await page.getByTestId('patient-assistant').getByRole('heading',{name:/Ask about/}).waitFor();assert.equal(await page.getByRole('article',{name:'Patient record answer'}).count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: patient API/UI, periods and follow-ups, clickable sources, neutral boundary, patient isolation, changed-record invalidation, late-response isolation, mobile layout and PDF assistant separation');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
