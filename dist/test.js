// Optional local regression harness: open ?test. Reports in the page, never uploads.
export async function run(api){
 const out=document.createElement('pre');out.id='test-results';Object.assign(out.style,{position:'fixed',top:'80px',left:'20px',zIndex:20,background:'#122b24',padding:'20px',fontSize:'12px',maxHeight:'70vh',overflow:'auto',maxWidth:'90vw'});document.body.append(out);
 const results=[];const check=(name,condition)=>{results.push({name,pass:!!condition});out.textContent=JSON.stringify(results,null,2);if(!condition)throw Error('Test: '+name);};
 api.state.paused=true;api.state.animation=false;api.state.time=0;api.setQuality('eco');
 const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>8)n++;return n;};
 const initial=api.readPixels();check('render no uniforme',new Set(initial).size>30);
 for(const setting of ['water','shadows','materials','shadowSoft']){api.state[setting]=false;const pixels=api.readPixels();check(setting+' modifica imagen',diff(initial,pixels)>20);api.state[setting]=true;}
 api.setTime(3);check('ondas animadas',diff(initial,api.readPixels())>20);api.setTime(0);
 for(const name of ['materials','building','shore']){api.useScene(name);check('escena '+name,api.readPixels().some(x=>x!==0));}
 api.useScene('building');api.state.shadows=false;const clearFoundation=api.readPixels();
 api.state.shadows=true;check('sombras cambian el contacto de la edificación',diff(clearFoundation,api.readPixels())>20);
 for(const biome of ['forest','desert','snow','tropical','bamboo']){api.useBiome(biome);api.render();check('bioma '+biome,api.gl.getError()===0);}
 for(const name of ['eco','balanced','detail']){api.setQuality(name);api.render();check('calidad '+name,api.gl.getError()===0);}
 api.setQuality('eco');api.useScene('shore');api.state.paused=false;api.state.animation=true;api.state.ssr=false;
 out.textContent='PASS — '+results.length+' comprobaciones\n'+JSON.stringify(results,null,2);
 const close=document.createElement('button');close.textContent='Cerrar pruebas';close.onclick=()=>out.remove();out.append(close);
}
