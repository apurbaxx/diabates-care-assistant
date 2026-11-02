const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultNavigationTimeout(120000);page.setDefaultTimeout(45000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let knowledgeRequests=0;page.on('request',r=>{if(r.url().includes('/api/knowledge-assistant/search'))knowledgeRequests++;});
  await page.addInitScript(()=>localStorage.setItem('cliniq:workspace-tour:v1','seen'));
  await page.addInitScript(()=>localStorage.setItem('cliniq:welcome:v1',JSON.stringify({name:'Test',completed:true})));
  const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
  await page.goto(base);await page.getByRole('heading',{name:'Doctor workspace'}).waitFor();
  const ids=await page.evaluate(()=>{
   const saved=JSON.parse(localStorage.getItem('diabetes-care-assistant-store'));
   const p=saved.state.patients.find(p=>p.name==='Arjun Patel');p.visits.at(-1).clinicianNote='Patient reports tingling in a clinician note.';
   localStorage.setItem('diabetes-care-assistant-store',JSON.stringify(saved));return {patient:p.id,other:saved.state.patients.find(other=>other.id!==p.id).id};
  });
  const panel=page.locator('#assistant').getByTestId('patient-assistant');
  async function openAssistant(){await panel.getByLabel('Question about patient record').waitFor();assert.equal(await page.getByRole('dialog',{name:'Patient record assistant disclaimer'}).count(),0);}
  await page.goto(`${base}/patient/${ids.patient}#assistant`);
  await openAssistant();
  assert.equal(await page.getByLabel('Question about patient record').count(),2,'Both bottom and sidebar assistants accept questions directly');
  assert(await page.locator('#assistant').evaluate(el=>el.parentElement.lastElementChild===el),'AI Assistant remains the last patient record section');
  await page.locator('.record-references').getByLabel('Question about patient record').fill('Show medications');
  assert.equal(await panel.getByLabel('Question about patient record').inputValue(),'','Assistant inputs remain independent');
  await page.reload();await openAssistant();
  await panel.getByRole('heading',{name:/Ask about Arjun/}).waitFor();
  const upperPanel=page.locator('.record-references').getByTestId('patient-assistant');
  const suggestion=upperPanel.locator('button.rounded-full').first();
  const suggestionText=await suggestion.innerText();
  await suggestion.click();
  const showSuggestions=upperPanel.getByRole('button',{name:'Show suggestions',exact:true});
  await showSuggestions.waitFor();assert.equal(await showSuggestions.getAttribute('aria-expanded'),'false');
  assert.equal(await suggestion.isVisible(),false,'Selected suggestions collapse in the upper assistant');
  await upperPanel.getByText(`You asked: ${suggestionText}`,{exact:true}).waitFor();
  await showSuggestions.click();assert.equal(await suggestion.isVisible(),true,'Suggestions can be reopened');
  await upperPanel.getByRole('button',{name:'Hide suggestions',exact:true}).click();
  assert.equal(await panel.locator('button.rounded-full').first().isVisible(),true,'Bottom assistant suggestions remain visible');
  await page.reload();await openAssistant();

  async function ask(question){await panel.getByLabel('Question about patient record').fill(question);await panel.getByRole('button',{name:'Ask patient assistant',exact:true}).click();await panel.getByText(`You asked: ${question}`,{exact:true}).first().waitFor();return panel.getByRole('article',{name:'Patient record answer'}).first();}
  const first=await ask('Show HbA1c over the last six months');assert.match(await first.innerText(),/HbA1c/);assert(await first.getByRole('button',{name:/Show source/}).count()>0);
  await first.getByRole('button',{name:/Show source/}).first().click();await page.getByRole('heading',{name:'Patient record source',exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  const follow=await ask('Only the last month');assert.match(await follow.innerText(),/HbA1c/);assert(!(await follow.innerText()).includes('No active medication'));
  const neutral=await ask('Is this bad?');assert.match(await neutral.innerText(),/do not determine diagnoses/);
  const notes=await ask('Search notes for tingling');assert.match(await notes.innerText(),/Matching clinician note/);await notes.getByRole('button',{name:/Show source/}).first().click();await page.locator('.record-evidence').getByText('Patient reports tingling in a clinician note.',{exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  const labsOnly=await ask('All lab findings');assert(await labsOnly.getByRole('region',{name:'Laboratory results',exact:true}).count()>0);assert.equal(await labsOnly.getByRole('region',{name:'Medications',exact:true}).count(),0);assert.equal(await labsOnly.getByRole('region',{name:'Vitals',exact:true}).count(),0);
  const labTable=labsOnly.getByRole('table',{name:'Laboratory results',exact:true});assert.equal(await labTable.count(),1);
  const expandLabs=labsOnly.getByRole('button',{name:/Show all .* rows/});
  assert.equal(await labTable.locator('tbody tr').count(),5);await expandLabs.click();assert(await labTable.locator('tbody tr').count()>5);
  await labsOnly.getByRole('button',{name:/Show fewer rows/}).click();assert.equal(await labTable.locator('tbody tr').count(),5);
  await labsOnly.getByRole('searchbox',{name:'Filter Laboratory results rows'}).fill('HbA1c');assert(await labTable.locator('tbody tr').count()>0);assert((await labTable.locator('tbody th').allInnerTexts()).every(text=>text==='HbA1c'));
  await labsOnly.getByRole('searchbox',{name:'Filter Laboratory results rows'}).fill('no-such-test');assert.equal(await labTable.locator('tbody tr').count(),0);await labsOnly.getByText('No rows match this filter. Clear it to see all returned results.',{exact:true}).waitFor();
  await labsOnly.getByRole('button',{name:'Clear filter',exact:true}).click();assert.equal(await labTable.locator('tbody tr').count(),5);
  await labTable.getByRole('button',{name:/Show source/}).first().click();await page.getByRole('heading',{name:'Patient record source',exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  await panel.screenshot({path:'test-results/assistant-tables.png'});
  const medsOnly=await ask('All medications taken by the patient');assert(await medsOnly.getByRole('region',{name:'Medications',exact:true}).count()>0);assert.equal(await medsOnly.getByRole('region',{name:'Laboratory results',exact:true}).count(),0);assert.match(await medsOnly.innerText(),/does not confirm that it was taken/);assert(await medsOnly.getByRole('button',{name:/Show source/}).count()>0);
  const multi=await ask('Show HbA1c and medication history');assert(await multi.getByRole('region',{name:'Laboratory results',exact:true}).count()>0);assert(await multi.getByRole('region',{name:'Medications',exact:true}).count()>0);assert.equal(await multi.getByRole('region',{name:'Vitals',exact:true}).count(),0);
  assert.equal(await panel.locator('.assistant-exchange[open]').count(),1,'Earlier answers collapse automatically');
  await panel.getByRole('button',{name:'Clear conversation',exact:true}).click();assert.equal(await panel.getByRole('article',{name:'Patient record answer'}).count(),0);
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
  await page.goto(`${base}/patient/${ids.other}#assistant`);await openAssistant();await panel.getByRole('heading',{name:/Ask about/}).waitFor();assert.equal(await page.getByRole('article',{name:'Patient record answer'}).count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: patient API/UI, periods and follow-ups, clickable sources, neutral boundary, patient isolation, changed-record invalidation, late-response isolation, mobile layout and PDF assistant separation');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
