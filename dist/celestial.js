// Fictional sky format v1. Independent of browser time and the terrestrial catalogue.
export const TAU=Math.PI*2;
export const angularRadiusBounds=Object.freeze({min:.05,max:2});
const defaultRadii={starRadiusDegrees:.006*180/Math.PI,satelliteRadiusDegrees:.007*180/Math.PI};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function generateWorld(seed=12345){
 seed=Number(seed)>>>0;let s=seed;const rng=()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};
 const stars=Array.from({length:1800},()=>[rng()*TAU,Math.asin(rng()*2-1),.18+Math.pow(rng(),5)*.82,rng()]);
 return {format:'pleiade-sky',version:1,seed,name:'Mundo '+seed,elapsedDays:.5,daySeconds:720,latitude:.55,moonPeriod:19+rng()*12,moonPhase:rng()*TAU,...defaultRadii,stars};
}
export function validateWorld(w){
 if(!w||w.format!=='pleiade-sky'||w.version!==1||!Number.isInteger(w.seed)||w.seed<0||w.seed>4294967295||typeof w.name!=='string'||w.name.length>80)throw Error('Formato de mundo no compatible.');
 for(const [k,a,b]of[['elapsedDays',0,1e7],['daySeconds',60,86400],['latitude',-1.4,1.4],['moonPeriod',2,1000],['moonPhase',0,TAU]])if(!Number.isFinite(w[k])||w[k]<a||w[k]>b)throw Error('Parámetro celeste inválido: '+k);
 if(!Array.isArray(w.stars)||w.stars.length!==1800||w.stars.some(s=>!Array.isArray(s)||s.length!==4||s.some(x=>!Number.isFinite(x))||s[0]<0||s[0]>=TAU||Math.abs(s[1])>Math.PI/2||s[2]<0||s[2]>1||s[3]<0||s[3]>1))throw Error('Catálogo estelar inválido.');
 for(const key of Object.keys(defaultRadii)){
  if(Object.hasOwn(w,key)&&(!Number.isFinite(w[key])||w[key]<angularRadiusBounds.min||w[key]>angularRadiusBounds.max))throw Error('Radio aparente fuera del rango permitido.');
 }
 return {...defaultRadii,...structuredClone(w)};
}
export function celestialFrame(w){
 const phase=(w.elapsedDays%1)*TAU,lat=w.latitude;
 const rotate=v=>{const c=Math.cos(phase),s=Math.sin(phase),x=c*v[0]-s*v[1],y=s*v[0]+c*v[1];return [x,y*Math.cos(lat)-v[2]*Math.sin(lat),y*Math.sin(lat)+v[2]*Math.cos(lat)];};
 const sun=rotate([0,-1,0]);const orbit=w.moonPhase+w.elapsedDays/w.moonPeriod*TAU;
 const moon=rotate([Math.sin(orbit),-Math.cos(orbit)*Math.cos(.15),Math.cos(orbit)*Math.sin(.15)]);
 const daylight=clamp((sun[1]+.12)/.32,0,1),strength=Math.max(0,sun[1]);
 const moonPhase=(1-sun.reduce((s,x,i)=>s+x*moon[i],0))*.5,moonPower=.025*Math.max(0,moon[1])*moonPhase;
 const warm=clamp(strength*4,0,1),sunPower=4.4*Math.sqrt(strength);
 return {sun,moon,phase,latitude:lat,daylight,moonPhase,light:strength>0?sun:moon,lightColor:strength>0?[sunPower,sunPower*(.42+.48*warm),sunPower*(.22+.51*warm)]:[moonPower*.65,moonPower*.8,moonPower],ambient:.025+.975*daylight};
}
export function starAtlas(w,width=512,height=256){
 // Angular catalogue cache: strongest source per cell, never painted blobs.
 const data=new Float32Array(width*height*4);
 for(const [ra,dec,power,t]of w.stars){const x=Math.min(width-1,Math.floor(ra/TAU*width)),y=Math.min(height-1,Math.floor((dec/Math.PI+.5)*height)),k=(y*width+x)*4;
 if(power>data[k+2]){data[k]=ra;data[k+1]=dec;data[k+2]=power;data[k+3]=t;}}
 return data;
}
// Coarse light-path estimate for this small scene, not a cloud shadow map.
export function cloudTransmission(w,d,coverage,origin=[0,0,0]){
 if(coverage<=0)return 1;if(d[1]<=0)return 0;
 const fract=x=>x-Math.floor(x),mix=(a,b,t)=>a+(b-a)*t,smooth=(a,b,x)=>{let t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
 const hash=p=>fract(Math.sin(p[0]*127.1+p[1]*311.7+p[2]*74.7+w.seed%65536)*43758.5453);
 const noise=p=>{const cell=p.map(Math.floor),f=p.map(x=>{let t=fract(x);return t*t*(3-2*t);});let v=[];for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)v.push(hash([cell[0]+x,cell[1]+y,cell[2]+z]));return mix(mix(mix(v[0],v[1],f[0]),mix(v[2],v[3],f[0]),f[1]),mix(mix(v[4],v[5],f[0]),mix(v[6],v[7],f[0]),f[1]),f[2]);};
 let optical=0;const time=w.elapsedDays*w.daySeconds;
 for(const [base,top] of [[900,1700],[3200,3650]]){let entry=Math.max(0,(base-origin[1])/d[1]),end=Math.min(6000,(top-origin[1])/d[1]);if(end<=entry)continue;let step=(end-entry)/8;
 for(let i=0;i<8;i++){const point=origin.map((v,j)=>v+d[j]*(entry+(i+.5)*step));let q=point.map(v=>v*.0012);q[0]+=time*.0008;q[2]+=time*.0003;let h=(point[1]-base)/(top-base),shape=noise(q)*.7+noise(q.map(v=>v*2.7))*.3;optical+=smooth(1-coverage*.7,1-coverage*.7+.17,shape)*smooth(0,.18,h)*(1-smooth(.65,1,h))*.004*step;}}
 return Math.exp(-optical);
}
