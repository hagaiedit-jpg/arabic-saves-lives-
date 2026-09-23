const { chromium } = require('playwright-core');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const pg=await b.newPage({viewport:{width:800,height:560}});
  const errs=[];pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto('file://'+__dirname+'/gen.html'); await pg.waitForTimeout(500);
  const only=process.argv.slice(2);   // optional: node gen.js taxi ambulance — render just these
  const jobs=await pg.evaluate(()=>window.JOBS.map(j=>j[0]));
  require('fs').mkdirSync(__dirname+'/../../img/written',{recursive:true});
  for(let i=0;i<jobs.length;i++){
    if(only.length && only.indexOf(jobs[i])===-1) continue;
    await pg.evaluate(i=>{document.getElementById('stage').innerHTML=window.JOBS[i][1];},i);
    await pg.evaluate(()=>document.fonts.ready); await pg.waitForTimeout(120);
    await (await pg.$('#stage svg')).screenshot({path:__dirname+'/../../img/written/'+jobs[i]+'.jpg',type:'jpeg',quality:80});
  }
  console.log('rendered',only.length||jobs.length,'errors',JSON.stringify(errs)); await b.close();
})();
