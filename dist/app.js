import {generateWorld,validateWorld,celestialFrame,starAtlas,cloudTransmission,angularRadiusBounds} from './celestial.js';
import {biomes,createBiome,copyPrototype} from './biomes.js';
import {createWatershed,waterModes,driftSamples,channel,waterBase} from './watershed.js';
import {climateAt,seasons,weatherModes} from './climate.js';
import {moveDetached,plantContact} from './plant_contact.js';
const $=id=>document.getElementById(id), canvas=$('view');
const VERSION='0.000.00.018';
const params=new URLSearchParams(location.search);
const state={ready:false,scene:'shore',biome:'forest',waterMode:'lake',underwater:false,buildingForm:'cabin',season:'summer',weather:'clear',quality:window.PleiadeAndroid?'eco':'balanced',materials:true,shadows:true,shadowSoft:true,water:true,ssr:false,contact:false,animation:true,waveStrength:.35,time:0,waveTime:0,frames:0,errors:[],fps:0,hdr:false,paused:false};
window.pleiade={state};
const math={
 sub:(a,b)=>a.map((x,i)=>x-b[i]),add:(a,b)=>a.map((x,i)=>x+b[i]),scale:(a,s)=>a.map(x=>x*s),
 dot:(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
 unit:a=>{let l=Math.hypot(...a);return a.map(x=>x/(l||1));},
 mul:(a,b)=>{const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;},
 look:(eye,target)=>{let z=math.unit(math.sub(eye,target)),x=math.unit(math.cross([0,1,0],z)),y=math.cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-math.dot(x,eye),-math.dot(y,eye),-math.dot(z,eye),1]);},
 perspective:(fov,aspect)=>{let f=1/Math.tan(fov/2),n=.1,fz=250;return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(fz+n)/(n-fz),-1,0,0,2*fz*n/(n-fz),0]);},
 ortho:(l,r,b,t,n,f)=>new Float32Array([2/(r-l),0,0,0,0,2/(t-b),0,0,0,0,-2/(f-n),0,-(r+l)/(r-l),-(t+b)/(t-b),-(f+n)/(f-n),1])
};
let gl,programs={},meshes=new Map(),groups=[],materialTextures=[],targets=[],sceneFbo,shadowFbo,shadowTexture,visibilityTexture,shadowSize=1024,emptyVAO,sceneData,manifest,shadowDirty=true,frameRequest=0,lastFrame=0,lastTime=0,statTime=0,statFrames=0,capturePending=false,toastTimer;
let world=generateWorld(),starTexture,skyFrame,skyRunning=false,skyView=false,flightAltitude=2,opticalFov=62,cloudAmount=0,turbidity=.3,lastSaved=0;
try{const saved=localStorage.getItem('pleiade-world-v1');if(saved)world=validateWorld(JSON.parse(saved));}catch{}
let cloudTexture,cloudFbo,cloudWidth=0,cloudKey='',cloudBuilds=0,cloudReuse=true;
let camera={target:[-1,0,-2],yaw:.8,pitch:.32,distance:15};
let activeBiome, drawAnchor, layoutRevision=0, drawnRevision=-1, drawnSignature=0, submittedTriangles=0, needleBundles=0, foliageBundles=0;
let watershed,shoreObjects,waterFbo,waterDepth,glassGroup;
let climate=climateAt('summer','clear',0),leafStep=16,detached=null,lastDetachedAge=0,shadowWindStep=-1;
const buildingNames={cabin:'La cabaña',stone:'El refugio de piedra',shelter:'El pabellón de madera',house:'La casa de teja'};
const shoreNames={lake:'La orilla',river:'El río',falls:'La cascada'};
const limits={eco:{size:640,shadow:512,mid:30000,near:9000},balanced:{size:960,shadow:1024,mid:36000,near:54000},detail:{size:1280,shadow:2048,mid:41000,near:150000}};
let lightVP=math.mul(math.ortho(-32,32,-32,32,.1,180),math.look([-45,75,45],[0,0,0]));
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function fail(error){const message=String(error?.message||error);state.errors.push(message);state.ready=false;cancelAnimationFrame(frameRequest);$('status').hidden=false;$('status').querySelector('h2').textContent='No se ha podido iniciar';$('status').querySelector('.loader').hidden=true;$('load-status').textContent=message;$('retry').hidden=false;$('state').textContent='Sin render';}
$('retry').onclick=()=>location.reload();
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
async function fetchData(path,type='json'){let r=await fetch(path,{cache:'no-cache'});if(!r.ok)throw Error(`No se pudo cargar ${path} (${r.status}). Recarga con conexión.`);return type==='json'?r.json():r.arrayBuffer();}
function program(vs,fs){const p=gl.createProgram();for(const [type,source]of[[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){let sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error('Shader incompatible: '+gl.getShaderInfoLog(sh));gl.attachShader(p,sh);gl.deleteShader(sh);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Enlace gráfico: '+gl.getProgramInfoLog(p));return {id:p,loc:new Map()};}
function loc(p,name){if(!p.loc.has(name))p.loc.set(name,gl.getUniformLocation(p.id,name));return p.loc.get(name);}
function ui(p,n,v){gl.uniform1i(loc(p,n),v);}function uf(p,n,v){gl.uniform1f(loc(p,n),v);}function uv(p,n,v){gl.uniform3fv(loc(p,n),v);}function um(p,n,v){gl.uniformMatrix4fv(loc(p,n),false,v);}
function bind(t,unit){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);}
function texture(w,h,internal,format,type,data,repeat=false){let t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,data);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);return t;}
function checkFbo(name){if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error(`El navegador no admite el destino gráfico ${name}. Prueba Chrome actualizado.`);}
function resize(){const limit=limits[state.quality].size,aspect=innerWidth/innerHeight;let w,h;if(aspect>=1){w=Math.min(innerWidth*devicePixelRatio,limit);h=w/aspect;}else{h=Math.min(innerHeight*devicePixelRatio,limit);w=h*aspect;}w=Math.max(1,Math.round(w));h=Math.max(1,Math.round(h));if(canvas.width===w&&canvas.height===h&&targets.length)return;
 canvas.width=w;canvas.height=h;for(const t of targets)gl.deleteTexture(t);targets=[];gl.bindFramebuffer(gl.FRAMEBUFFER,sceneFbo);
 for(let i=0;i<4;i++){let t=i===3?texture(w,h,gl.DEPTH_COMPONENT24,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null):texture(w,h,state.hdr?gl.RGBA16F:gl.RGBA8,gl.RGBA,state.hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);targets.push(t);gl.framebufferTexture2D(gl.FRAMEBUFFER,i===3?gl.DEPTH_ATTACHMENT:gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0);}
 gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1,gl.COLOR_ATTACHMENT2]);checkFbo('de la escena');gl.bindFramebuffer(gl.FRAMEBUFFER,null);$('resolution').textContent=w+' × '+h;
 if(waterDepth)gl.deleteTexture(waterDepth);
 waterDepth=texture(w,h,gl.DEPTH_COMPONENT24,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
 gl.bindFramebuffer(gl.FRAMEBUFFER,waterFbo);
 gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,waterDepth,0);
 gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);checkFbo('del agua');gl.bindFramebuffer(gl.FRAMEBUFFER,null);
}
function resizeShadow(){if(shadowTexture)gl.deleteTexture(shadowTexture);shadowSize=limits[state.quality].shadow;shadowTexture=texture(shadowSize,shadowSize,gl.DEPTH_COMPONENT24,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,shadowTexture,0);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);checkFbo('de sombras');gl.bindFramebuffer(gl.FRAMEBUFFER,null);shadowDirty=true;}
function makeMesh(item, vertices, indices, stride) {
 const vao=gl.createVertexArray(),vertex=gl.createBuffer(),index=gl.createBuffer(),instances=gl.createBuffer();
 const mesh={vao,vertex,index,instances,count:item.indices,far:item.far,farMaterial:item.farMaterial,mid:item.mid};
 gl.bindVertexArray(vao);
 gl.bindBuffer(gl.ARRAY_BUFFER,vertex);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
 for(let i=0;i<2;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,stride,i*12);}
 if(stride>=32){gl.enableVertexAttribArray(8);gl.vertexAttribPointer(8,2,gl.FLOAT,false,stride,24);}
 gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
 gl.bindBuffer(gl.ARRAY_BUFFER,instances);
 for(let i=0;i<6;i++){gl.enableVertexAttribArray(2+i);gl.vertexAttribPointer(2+i,4,gl.FLOAT,false,96,i*16);gl.vertexAttribDivisor(2+i,1);}
 meshes.set(item.id,mesh);
}
async function loadMesh(item){
 const [vertices,indices]=await Promise.all([fetchData(`assets/mesh-${item.id}.vbo`,'buffer'),fetchData(`assets/mesh-${item.id}.ibo`,'buffer')]);
 makeMesh(item,vertices,indices,sceneData.vertexStride??24);
 if(item.id===0)makeMesh({...item,id:'glass'},vertices,indices,sceneData.vertexStride??24);
}
function replaceMesh(id,data){
 const old=meshes.get(id);
 if(old){gl.deleteVertexArray(old.vao);for(const b of [old.vertex,old.index,old.instances])gl.deleteBuffer(b);}
 makeMesh({id,indices:data.indices.length},data.vertices,data.indices,32);
}
let waterContacts=new Float32Array();
function collectWaterContacts(mode,objects,rockIds){
 const contacts=[];
 for(const part of objects){
  if(!rockIds.has(part.mesh)&&![1,2,3,4,5].includes(part.section))continue;
  const m=part.instance;
  const vertical=(Math.abs(m[1])+Math.abs(m[5])+Math.abs(m[9]))*.5;
  const level=waterBase(mode,m[14]);
  const reach=Math.max(Math.hypot(m[0],m[2]),Math.hypot(m[8],m[10]),.09)*.5;
  if(Math.abs(m[13]-level)>vertical+.045||reach<.08)continue;
  if(mode!=='lake'&&Math.abs(m[12]-channel(m[14]))>4.45+reach)continue;
  if(contacts.some(([x,z])=>Math.hypot(x-m[12],z-m[14])<.65))continue;
  contacts.push([m[12],m[14],reach]);
 }
 return new Float32Array(contacts.slice(0,10).flat());
}
function regenerateShore(){
 watershed=createWatershed(state.waterMode,world.seed);
 replaceMesh('shore-land',watershed.land);replaceMesh('shore-water',watershed.water);
 const terrain=[...sceneData.shore[0].instance];
 shoreObjects=[{mesh:'shore-land',instance:terrain}];
 const zStart=state.waterMode==='falls'?8:0;
 let dy=0,dx=0,dz=0;
 for(const part of sceneData.shore.slice(1)){
  if(part.mesh===0||part.instance[22]===9)continue;
  const pose=part.instance.slice();
  const [x,y,z]=pose.slice(12,15);
  if(part.section===1||part.section===undefined){
   dx=state.waterMode==='lake'?0:2.8;
   dz=zStart;
   const oldGround=.08*x+.12*Math.sin(z*.15)+.02*Math.sin(x*.8+z*.4);
   dy=watershed.height(x+dx,z+dz)-oldGround;
  }
  pose[12]+=dx;pose[13]=y+dy;pose[14]+=dz;
  shoreObjects.push({...part,instance:pose});
 }
 const bank=[[-19,1],[-27,-1],[-32,1],[-38,-1],[13,1],[21,1],[29,1],[35,-1]];
 for(const [i,[z,side]] of bank.entries()){
  const x=state.waterMode==='lake'?6+2.6*Math.sin(i*2.4):channel(z)+side*(6.1+1.9*Math.sin(i*2.2));
  const kind=['birch2','spruce2','pine2'][i%3];
  const size=4.6+2.4*Math.sin((i+1)*.55)**2;
  copyPrototype(shoreObjects,sceneData.plants[kind],x,watershed.height(x,z)-.055,z,size,i*2.4,.88,true);
 }
 // Two partly submerged rocks provide a visible reference for the current.
 if(state.waterMode!=='lake'){
  const rocks=sceneData.meshIds.rock;
  for(const [z,lateral,size] of [[5.8,-1.7,.84],[-9.0,1.45,.60]]){
   const x=channel(z)+lateral,y=waterBase(state.waterMode,z)-size*.05;
   shoreObjects.push({mesh:rocks,instance:[size,0,0,0,0,size*.86,0,0,0,0,size*.91,0,x,y,z,1,.42,.43,.40,1,.86,0,9,0]});
  }
 }
 waterContacts=collectWaterContacts(state.waterMode,shoreObjects,new Set(sceneData.meshes.filter(m=>m.id===sceneData.meshIds.rock||m.name==='RockDetail').map(m=>m.id)));
 layoutRevision++;drawAnchor=null;shadowDirty=true;
}
function regenerateBiome(){
 activeBiome=createBiome(state.biome,world.seed,sceneData);
 for(const tile of activeBiome.terrain.pieces){
  const previous=meshes.get(tile.id);
  if(previous){
   gl.deleteVertexArray(previous.vao);
   for(const buffer of [previous.vertex,previous.index,previous.instances])gl.deleteBuffer(buffer);
  }
  makeMesh({id:tile.id,indices:tile.indices.length},tile.vertices,tile.indices,32);
 }
 layoutRevision++;drawAnchor=null;shadowDirty=true;
}
function uploadSceneMeshes({eye,forward,right,up}){
 const focal=canvas.height/(2*Math.tan(opticalFov*Math.PI/360));
 const tall=canvas.height/(2*focal),wide=canvas.width/(2*focal);
 const age=detached?Math.min(1.9,state.time-detached.time):0;
 if(detached&&age!==lastDetachedAge){drawAnchor=null;layoutRevision++;lastDetachedAge=age;}
 if(drawAnchor&&math.dot(forward,drawAnchor.forward)>.998&&Math.hypot(...math.sub(eye,drawAnchor.eye))<.22&&focal===drawAnchor.focal&&wide===drawAnchor.wide)return;
 drawAnchor={eye,forward,focal,wide};
 const source=state.scene==='biomes'?activeBiome.objects:state.scene==='shore'?shoreObjects:
  state.scene==='building'?(sceneData.buildingForms[state.buildingForm]??sceneData.building):
  sceneData.shore;
 const objects=state.scene==='materials'?moveDetached(source,detached,age,(x,z)=>.08*x+.12*Math.sin(z*.15)):source;
 const byMesh=new Map(),plan=[],near=[];
 const isBiome=state.scene==='biomes'||state.scene==='shore';
 let remaining=limits[state.quality].near, midBudget=limits[state.quality].mid;
 for(const [objectIndex,{mesh:id,instance,visible,detail,section}] of objects.entries()){
  if(visible===false)continue;
  if(state.scene==='materials'&&(id===0||instance[22]===9))continue;
  if(instance[23]===-7){
   const rank=(Math.imul(objectIndex+1,2654435761)>>>0)/4294967296;
   if(rank>leafStep/16)continue;
  }
  const mesh=meshes.get(id);
  const breadth=Math.max(Math.hypot(instance[0],instance[1],instance[2]),Math.hypot(instance[8],instance[9],instance[10]));
  const height=Math.hypot(instance[4],instance[5],instance[6]);
  const woody=section>=1&&section<=6;
  const offset=[instance[12]-eye[0],instance[13]-eye[1],instance[14]-eye[2]];
  const distance=Math.max(.25,Math.hypot(...offset));
  const depth=math.dot(offset,forward);
  const projected=focal/Math.max(.25,depth,distance*.72);
  if(isBiome&&typeof id==='number'&&distance>31){
   const margin=12+Math.max(breadth,height);
   if(depth < -margin || Math.abs(math.dot(offset,right))>Math.max(0,depth)*wide+margin ||
      Math.abs(math.dot(offset,up))>Math.max(0,depth)*tall+margin)continue;
  }
  const pixels=(woody?breadth:Math.max(breadth,height))*projected;
  if(detail&&pixels<(woody&&state.scene==='biomes'?1.4:woody?.6:3.5))continue;
  const item={id:instance[22]===18?'glass':mesh.far??id,instance,material:mesh.farMaterial,objectIndex};
  plan.push(item);
  const detailThreshold=woody?(state.quality==='detail'?6:12):(state.quality==='detail'?34:54);
  if(mesh.far!==undefined&&(pixels>detailThreshold||(mesh.mid!==undefined&&pixels>12))){
   const facing=Math.max(0,depth/distance);
   near.push({item,id,mesh,pixels,detailThreshold,priority:pixels*(.17+.83*facing*facing)});
  }
 }
 near.sort((a,b)=>b.priority-a.priority);
 const transitions=[];
 const transition=(item,id,weight)=>{
  if(weight>=1){item.id=id;item.material=undefined;return;}
  item.fade=-weight;transitions.push({...item,id,material:undefined,fade:weight});
 };
 const fraction=(x,lo,hi)=>Math.max(0,Math.min(1,Math.round((x-lo)*16/(hi-lo))/16));
 for(const {item,id,mesh,pixels,detailThreshold} of near){
  const count=meshes.get(item.id).count;
  if(mesh.mid===undefined){
   const cost=(mesh.count-count)/3;
   if(pixels>detailThreshold&&cost<=remaining){remaining-=cost;item.id=id;item.material=undefined;}
   continue;
  }
  const middleCount=meshes.get(mesh.mid).count;
  const low=fraction(pixels,12,31);
  const high=fraction(pixels,detailThreshold,detailThreshold+32);
  const entireCost=(mesh.count+(high<1?middleCount:0)-count)/3;
  if(high>0&&entireCost<=remaining){
   remaining-=entireCost;item.id=mesh.mid;item.material=undefined;transition(item,id,high);
  }else if(low>0){
   const cost=(middleCount-(low===1?count:0))/3;
   if(cost<=midBudget){midBudget-=cost;transition(item,mesh.mid,low);}
  }
 }
 let signature=0;
 plan.push(...transitions);
 for(const {id,objectIndex,fade} of plan)signature=Math.imul(signature^(typeof id==='number'?id:71+objectIndex)^Math.imul(objectIndex,113)^Math.imul(Math.round((fade??1)*16),773),16777619);
 if(drawnRevision===layoutRevision&&drawnSignature===signature)return;
 drawnRevision=layoutRevision;drawnSignature=signature;
 for(const {id,instance,material,fade} of plan){
  if(!byMesh.has(id))byMesh.set(id,[]);
  const batch=byMesh.get(id);
  if(material===undefined&&fade===undefined)batch.push(...instance);
  else{const copy=instance.slice();if(material!==undefined)copy[22]=material;if(fade!==undefined)copy[19]=fade;batch.push(...copy);}
 }
 groups=[];
 glassGroup=null;
 submittedTriangles=0;
 needleBundles=0;
 foliageBundles=0;
 for(const [id,data] of byMesh){
  const mesh=meshes.get(id);
  gl.bindBuffer(gl.ARRAY_BUFFER,mesh.instances);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
  const instances=data.length/24;
  if(sceneData.meshes.some(candidate=>candidate.mid===id)||mesh.mid!==undefined){
   foliageBundles+=instances;
   if(data[22]===20||data[22]===21)needleBundles+=instances;
  }
  if(id==='glass')glassGroup={mesh,instances};else groups.push({mesh,instances});
  submittedTriangles+=mesh.count/3*instances;
 }
 shadowDirty=true;
}
function useScene(name){
 if(!['building','materials','shore','biomes'].includes(name))return;
 state.scene=name;
 state.underwater=false;$('dive').textContent='Mirar bajo el agua';$('dive').disabled=name!=='shore';
 if(name==='biomes')regenerateBiome();
 if(name==='shore'&&!watershed)regenerateShore();
 state.water=name==='shore';$('water').checked=state.water;$('water').disabled=name!=='shore';$('ssr').disabled=name!=='shore';
 const labels={shore:[shoreNames[state.waterMode],'Agua, corriente y vegetación de ribera.'],materials:['Vegetación de cerca','Agujas, frondes, hojas y corteza.'],building:[buildingNames[state.buildingForm],'Madera, piedra y sombras de contacto.']};
 const [title,description]=name==='biomes'?[biomes[state.biome].title,biomes[state.biome].description]:labels[name];
 $('scene-title').textContent=title;$('scene-description').textContent=description;
 $('biome-control').hidden=name!=='biomes';
 $('shore-control').hidden=name!=='shore';$('building-control').hidden=name!=='building';
 $('impact-actions').hidden=name!=='materials';
 if(name!=='materials')detached=null;
 document.querySelectorAll('[data-scene]').forEach(button=>{let active=button.dataset.scene===name;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
 layoutRevision++;drawAnchor=null;shadowDirty=true;resetCamera();
}
function setWaterMode(mode){
 if(!waterModes.includes(mode))return;
 state.waterMode=mode;$('water-mode').value=mode;
 regenerateShore();useScene('shore');
}
function setBuildingForm(form){
 if(!Object.hasOwn(buildingNames,form))return;
 state.buildingForm=form;$('building-form').value=form;useScene('building');
}
function setClimate(season,weather){
 if(!seasons.includes(season)||!weatherModes.includes(weather))return;
 state.season=season;state.weather=weather;$('season').value=season;$('weather').value=weather;
}
function impact(point,impulse){
 if(state.scene!=='materials')return false;
 const contact=plantContact(sceneData.shore,point,impulse);
 if(!contact)return false;
 detached={...contact,time:state.time};drawAnchor=null;layoutRevision++;lastDetachedAge=0;return true;
}
function useBiome(name){
 if(!Object.hasOwn(biomes,name))return;
 state.biome=name;$('biome').value=name;
 if(state.ready)useScene('biomes');
}
function resetCamera(){
 skyView=false;
 if(state.scene==='biomes'){
  const [x,rise,z,yaw,pitch,distance]=biomes[state.biome].view;
  camera={target:[x,activeBiome.height(x,z)+rise,z],yaw,pitch,distance};
 }else if(state.scene==='building')camera={target:[0,1.65,0],yaw:.72,pitch:.26,distance:14.5};
 else if(state.scene==='materials')camera={target:[4.3,1.4,-3.2],yaw:.49,pitch:.26,distance:7.2};
 else if(state.waterMode==='falls')camera={target:[-1.65,2.1,.0],yaw:2.53,pitch:.24,distance:24};
 else if(state.waterMode==='river')camera={target:[-1.7,1.2,-5.2],yaw:.79,pitch:.29,distance:20};
 else camera={target:[1.4,.65,-5.0],yaw:.61,pitch:.28,distance:19};
}
function cameraFrame(){let cp=Math.cos(camera.pitch),eye=math.add(camera.target,[Math.sin(camera.yaw)*cp*camera.distance,Math.sin(camera.pitch)*camera.distance,Math.cos(camera.yaw)*cp*camera.distance]);const ground=state.scene==='biomes'?activeBiome:state.scene==='shore'?watershed:null;eye[1]=Math.max(ground?ground.height(eye[0],eye[2])+.46:.3,eye[1]);let target=camera.target;if(skyView){eye=[camera.target[0],flightAltitude,camera.target[2]];target=math.add(eye,[Math.sin(camera.yaw)*cp,Math.sin(camera.pitch),Math.cos(camera.yaw)*cp]);}
 if(state.underwater&&state.scene==='shore'){
  const z=state.waterMode==='falls'?-7:-6;
  eye=[state.waterMode==='lake'?-11:channel(z),waterBase(state.waterMode,z)-.43,z];
  target=math.add(eye,[Math.sin(camera.yaw)*2,Math.min(.8,camera.pitch)*1.3-.45,Math.cos(camera.yaw)*2]);
 }
 let v=math.look(eye,target),p=math.perspective(opticalFov*Math.PI/180,canvas.width/canvas.height);return {eye,v,p,vp:math.mul(p,v),right:[v[0],v[4],v[8]],up:[v[1],v[5],v[9]],forward:[-v[2],-v[6],-v[10]]};}
function setQuality(name){state.quality=name;$('quality').value=name;if(state.ready){drawAnchor=null;resizeShadow();resize();}}
function drawGroup(g){gl.bindVertexArray(g.mesh.vao);gl.drawElementsInstanced(gl.TRIANGLES,g.mesh.count,gl.UNSIGNED_INT,0,g.instances);}
function drawGroups(){for(const g of groups)drawGroup(g);}
function drawWater(c){
 const mesh=meshes.get('shore-water'),p=programs.water;
 gl.bindFramebuffer(gl.FRAMEBUFFER,waterFbo);gl.clear(gl.DEPTH_BUFFER_BIT);
 gl.disable(gl.CULL_FACE);gl.useProgram(p.id);um(p,'uVP',c.vp);
 setWaterUniforms(p);gl.bindVertexArray(mesh.vao);gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_INT,0);
}
function setWaterUniforms(p){
 ui(p,'uWaterMode',waterModes.indexOf(state.waterMode));
 uf(p,'uWaveStrength',state.waveStrength);uf(p,'uWaterTime',state.waveTime);uf(p,'uFlowTime',state.time);
}
function drawGlass(c){
 if(!glassGroup)return;
 const p=programs.glass;gl.useProgram(p.id);
 skyUniforms(p);um(p,'uVP',c.vp);uv(p,'uEye',c.eye);uf(p,'uExposure',1);
 bind(cloudTexture||visibilityTexture,13);ui(p,'uCloudMap',13);ui(p,'uCloudCached',cloudReuse&&cloudAmount>0);
 bind(targets[3],2);ui(p,'uOpaqueDepth',2);
 gl.enable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
 drawGroup(glassGroup);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);
}
function drawWeather(c){
 const kinds=[];
 if(state.weather==='rain')kinds.push([1,146]);
 if(state.weather==='snow')kinds.push([2,118]);
 if(climate.fall&&state.scene!=='building'&&!(state.scene==='biomes'&&state.biome!=='forest'))kinds.push([3,39]);
 if(!kinds.length||skyView)return;
 const p=programs.weather;gl.useProgram(p.id);um(p,'uVP',c.vp);uv(p,'uCameraEye',c.eye);
 uf(p,'uTime',state.time);uf(p,'uWind',climate.wind);uf(p,'uScreenHeight',canvas.height);
 const origin=state.scene==='biomes'?[camera.target[0],camera.target[1],camera.target[2]]:
  [5+(state.scene==='shore'&&state.waterMode!=='lake'?2.8:0),2,-10.6+(state.scene==='shore'&&state.waterMode==='falls'?8:0)];
 uv(p,'uLeafOrigin',origin);bind(targets[3],2);ui(p,'uOpaqueDepth',2);
 gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.bindVertexArray(emptyVAO);
 for(const [kind,count] of kinds){ui(p,'uWeatherKind',kind);gl.drawArrays(gl.POINTS,0,count);}
 gl.disable(gl.BLEND);
}
function saveWorld(){try{localStorage.setItem('pleiade-world-v1',JSON.stringify(world));}catch{toast('No se pudo guardar en este navegador. Exporta el mundo.');}}
function importWorldText(text){try{applyWorld(JSON.parse(text));toast('Mundo y reloj restaurados.');}catch(e){toast(e.message);}}
function uploadStars(){if(starTexture)gl.deleteTexture(starTexture);starTexture=texture(512,256,gl.RGBA32F,gl.RGBA,gl.FLOAT,starAtlas(world),true);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
function syncSkyUI(){$('world-seed').value=world.seed;$('sky-hour').value=(world.elapsedDays%1)*24;$('sky-clock').textContent='Día '+Math.floor(world.elapsedDays)+' · '+((world.elapsedDays%1)*24).toFixed(1)+' h';}
const radiusControls=[['star-radius','starRadiusDegrees'],['satellite-radius','satelliteRadiusDegrees']];
const radiusLabel=(id,degrees)=>{$(id+'-label').textContent=degrees.toFixed(2)+'°';};
function syncRadiusUI(){
 for(const [id,key] of radiusControls){$(id).value=world[key];radiusLabel(id,world[key]);}
}
function applyWorld(w){world=validateWorld(w);if(state.scene==='biomes')regenerateBiome();if(watershed)regenerateShore();uploadStars();shadowDirty=true;syncSkyUI();syncRadiusUI();saveWorld();}
function skyUniforms(p){uf(p,'uSkyPixelAngle',2*Math.tan(opticalFov*Math.PI/360)/canvas.height);uf(p,'uWorldSeed',world.seed%65536);uf(p,'uCloudAmount',cloudAmount);uf(p,'uCloudTime',world.elapsedDays*world.daySeconds);uv(p,'uSkyObserver',cameraFrame().eye);uv(p,'uSunDirection',skyFrame.sun);uv(p,'uMoonDirection',skyFrame.moon);uf(p,'uSunRadius',world.starRadiusDegrees*Math.PI/180);uf(p,'uMoonRadius',world.satelliteRadiusDegrees*Math.PI/180);uv(p,'uLightColor',skyFrame.lightColor);uv(p,'uSkyLightDirection',skyFrame.light);uv(p,'lightDirection',skyFrame.light);uf(p,'uDaylight',skyFrame.daylight);uf(p,'uSkyAmbient',skyFrame.ambient);uf(p,'uStarAngle',skyFrame.phase);uf(p,'uLatitude',skyFrame.latitude);bind(starTexture,12);ui(p,'uStars',12);}
function updateCloudCache(c){
 if(cloudAmount<=0||!cloudReuse)return;
 const width={eco:128,balanced:256,detail:384}[state.quality];
 if(width!==cloudWidth){if(cloudTexture)gl.deleteTexture(cloudTexture);cloudWidth=width;cloudTexture=texture(width,width/2,state.hdr?gl.RGBA16F:gl.RGBA8,gl.RGBA,state.hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);if(!cloudFbo)cloudFbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,cloudFbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,cloudTexture,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);checkFbo('de nubes');cloudKey='';}
 const key=JSON.stringify([world.seed,world.moonPhase,world.moonPeriod,world.latitude,cloudAmount,Math.floor(world.elapsedDays*world.daySeconds*4),...c.eye]);
 if(key===cloudKey)return;
 // The cloud pass never samples its own target.
 bind(visibilityTexture,13);gl.bindFramebuffer(gl.FRAMEBUFFER,cloudFbo);gl.viewport(0,0,width,width/2);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.useProgram(programs.cloud.id);skyUniforms(programs.cloud);gl.bindVertexArray(emptyVAO);gl.drawArrays(gl.TRIANGLES,0,3);cloudKey=key;cloudBuilds++;
}
function render(){if(!state.ready||gl.isContextLost())return;
 climate=climateAt(state.season,state.weather,world.elapsedDays);
 const density=Math.round(climate.leaves*16);
 if(density!==leafStep){leafStep=density;drawAnchor=null;layoutRevision++;}
 const windStep=Math.floor(state.time*3);
 if(state.weather!=='clear'&&windStep!==shadowWindStep){shadowWindStep=windStep;shadowDirty=true;}
 resize();skyFrame=celestialFrame(world);const cloudLight=cloudTransmission(world,skyFrame.light,cloudAmount);skyFrame.lightColor=skyFrame.lightColor.map(x=>x*cloudLight);skyFrame.ambient*=.5+.5*cloudLight;const range=state.scene==='biomes'?64:state.scene==='building'?12:32;lightVP=math.mul(math.ortho(-range,range,-range,range,.1,200),math.look(math.scale(skyFrame.light,100),[0,0,0]));const c=cameraFrame();uploadSceneMeshes(c);updateCloudCache(c);gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.disable(gl.BLEND);
 if(state.shadows&&shadowDirty){gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFbo);gl.viewport(0,0,shadowSize,shadowSize);gl.clear(gl.DEPTH_BUFFER_BIT);let p=programs.shadow;gl.useProgram(p.id);um(p,'uVP',lightVP);uf(p,'uTime',state.time);uf(p,'uWind',climate.wind);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(2,4);drawGroups();gl.disable(gl.POLYGON_OFFSET_FILL);shadowDirty=false;}
 gl.bindFramebuffer(gl.FRAMEBUFFER,sceneFbo);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);let p=programs.material;gl.useProgram(p.id);skyUniforms(p);um(p,'uVP',c.vp);um(p,'uView',c.v);um(p,'uLightVP',lightVP);uv(p,'uEye',c.eye);uf(p,'uTime',state.time);uf(p,'uWind',climate.wind);uv(p,'uClimate',[climate.autumn,climate.frost,climate.wet]);uf(p,'uWetTime',state.waveTime);uf(p,'uWaveStrength',state.waveStrength);uf(p,'uFogDensity',.0025);uf(p,'uTerrainSeed',world.seed%65536);ui(p,'uShadows',state.shadows);ui(p,'uShadowSoft',state.shadowSoft);ui(p,'uNatural',1);ui(p,'uMaterials',state.materials);ui(p,'uWet',state.scene==='shore'&&state.water&&state.waterMode==='lake');ui(p,'uVisibilityEnabled',0);bind(shadowTexture,0);bind(visibilityTexture,11);ui(p,'uShadow',0);materialTextures.forEach((t,i)=>bind(t,5+i));drawGroups();
 if(state.water&&state.scene==='shore')drawWater(c);
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);p=programs.composite;gl.useProgram(p.id);skyUniforms(p);bind(cloudTexture||visibilityTexture,13);ui(p,'uCloudMap',13);ui(p,'uCloudCached',cloudReuse&&cloudAmount>0);for(let i=0;i<4;i++)bind(targets[[0,1,3,2][i]],i);bind(waterDepth,4);ui(p,'uWaterDepth',4);ui(p,'uContact',state.hdr&&state.contact);ui(p,'uWater',state.water&&state.scene==='shore');ui(p,'uWaterSSR',state.ssr&&state.water);ui(p,'uUnderwater',state.underwater&&state.water);setWaterUniforms(p);ui(p,'uContactCount',waterContacts.length/3);
 if(waterContacts.length)gl.uniform3fv(loc(p,'uWaterContacts[0]'),waterContacts);
 if(state.water&&state.waterMode!=='lake')gl.uniform3fv(loc(p,'uDrift[0]'),driftSamples(state.waterMode,state.time));uf(p,'uExposure',1);uf(p,'uTurbidity',turbidity);ui(p,'uAA',1);uv(p,'uCameraEye',c.eye);uv(p,'uCameraRight',c.right);uv(p,'uCameraUp',c.up);uv(p,'uCameraForward',c.forward);gl.uniform2f(loc(p,'uProjectionScale'),c.p[0],c.p[5]);gl.bindVertexArray(emptyVAO);gl.drawArrays(gl.TRIANGLES,0,3);drawGlass(c);drawWeather(c);state.frames++;
 if(state.frames<4||params.has('test')){let error=gl.getError();if(error!==gl.NO_ERROR)throw Error('Error gráfico WebGL '+error);}
 if(capturePending){capturePending=false;canvas.toBlob(b=>{if(b)download(b,'Pleiade-tablet-'+state.scene+'.png');else toast('El navegador no ha podido guardar la imagen.');});}
}
function tick(now){
 frameRequest=requestAnimationFrame(tick);
 if(!state.ready||document.hidden||state.paused){lastTime=0;return;}
 if(now-lastFrame<1000/30-.7)return;
 const dt=lastTime?Math.max(0,Math.min(.25,(now-lastTime)/1000)):0;
 lastTime=now;lastFrame=now;
 state.time+=dt;
 if(state.animation)state.waveTime+=dt;
 if(skyRunning){
  world.elapsedDays+=dt/world.daySeconds;shadowDirty=true;syncSkyUI();
  if(now-lastSaved>5000){saveWorld();lastSaved=now;}
 }
 try{render();}catch(e){fail(e);return;}
 statFrames++;
 if(now-statTime>=1000){state.fps=statFrames*1000/(now-statTime);$('fps').textContent=state.fps.toFixed(0)+' FPS';statFrames=0;statTime=now;}
}
function download(blob,name){
 if(window.PleiadeAndroid){
  const reader=new FileReader();
  reader.onload=()=>window.PleiadeAndroid.saveFile(name,blob.type,reader.result.split(',')[1]);
  reader.onerror=()=>toast('No se pudo preparar el archivo.');
  reader.readAsDataURL(blob);
  return;
 }
 const a=document.createElement('a'),url=URL.createObjectURL(blob);
 a.href=url;a.download=name;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
 toast('Descarga solicitada: '+name);
}
function report(){return {viewer:VERSION,desktopBase:'0.003.0.17',browser:navigator.userAgent,screen:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},render:{width:canvas.width,height:canvas.height,shadow:shadowSize,shadowDepthMiB:shadowSize*shadowSize*4/1048576,trianglesPerPass:submittedTriangles,needleBundles,foliageBundles,shadowFilter:state.shadowSoft?'continuous-tent-9':'box-9',hdr:state.hdr},settings:{...state},glassPanes:glassGroup?.instances??0,shore:state.scene==='shore'?{mode:state.waterMode,width:watershed.area,contacts:waterContacts.length/3}:null,climate:{...climate},detached:detached?.pieces.size??0,biome:state.scene==='biomes'?{seed:world.seed,plants:activeBiome.plants,rocks:activeBiome.rocks,trees:activeBiome.trees,understory:activeBiome.understory,tiles:activeBiome.terrain.pieces.length,vines:activeBiome.vines}:null,celestial:{seed:world.seed,elapsedDays:world.elapsedDays,daySeconds:world.daySeconds,running:skyRunning,cloudAmount,flightAltitude,opticalFov,turbidity},camera,capabilities:{webgl:gl?gl.getParameter(gl.VERSION):null,maxTextureSize:gl?gl.getParameter(gl.MAX_TEXTURE_SIZE):null},cloudCache:{enabled:cloudReuse,width:cloudWidth,height:cloudWidth/2,updates:cloudBuilds,estimatedMiB:cloudWidth*cloudWidth/2*(state.hdr?8:4)/1048576},memoryPolicy:{budgetMiB:4096,kind:'design ceiling, not measured browser allocation'},note:'FPS de presentación del navegador; no es tiempo GPU ni un benchmark de la RTX.'};}
function setupUI(){
 $('biome').onchange=()=>useBiome($('biome').value);
 $('water-mode').onchange=()=>setWaterMode($('water-mode').value);
 $('building-form').onchange=()=>setBuildingForm($('building-form').value);
 $('dive').onclick=()=>{if(state.scene==='shore'){
  state.underwater=!state.underwater;skyView=false;
  $('dive').textContent=state.underwater?'Volver a la superficie':'Mirar bajo el agua';
 }};
 for(const id of ['season','weather'])$(id).onchange=()=>setClimate($('season').value,$('weather').value);
 $('impact').onclick=()=>{
  const branch=sceneData.shore.find(o=>o.section===5&&o.instance[12]>4&&o.instance[13]>2.0&&o.instance[14]>-8);
  if(branch){impact(branch.instance.slice(12,15),[1.35,.45,1.4]);}
 };
 $('restore-plant').onclick=()=>{detached=null;drawAnchor=null;layoutRevision++;};
 syncSkyUI();
 for(const [id,key] of radiusControls){
  const input=$(id);
  input.min=angularRadiusBounds.min;
  input.max=angularRadiusBounds.max;
  input.oninput=()=>{
   const degrees=Number(input.value);
   if(!Number.isFinite(degrees)||degrees<angularRadiusBounds.min||degrees>angularRadiusBounds.max)return;
   world[key]=degrees;radiusLabel(id,degrees);
  };
  input.onchange=saveWorld;
 }
 syncRadiusUI();
 $('turbidity').oninput=()=>{turbidity=Number($('turbidity').value);};
 $('cloud-reuse').onchange=()=>{cloudReuse=$('cloud-reuse').checked;};
 $('clouds').oninput=()=>{cloudAmount=Number($('clouds').value);};
 $('flight-altitude').oninput=()=>{flightAltitude=Number($('flight-altitude').value);skyView=true;$('altitude-label').textContent=flightAltitude+' m';};
 $('optical-fov').oninput=()=>{opticalFov=Number($('optical-fov').value);};
 $('look-sky').onclick=()=>{skyView=!skyView;camera.pitch=.45;};
 $('sky-run').onchange=()=>{skyRunning=$('sky-run').checked;saveWorld();};
 $('sky-hour').oninput=()=>{world.elapsedDays=Math.floor(world.elapsedDays)+Number($('sky-hour').value)/24;shadowDirty=true;syncSkyUI();saveWorld();};
 $('new-world').onclick=()=>{const seed=Number($('world-seed').value);if(!Number.isInteger(seed)||seed<0||seed>4294967295){toast('Usa una semilla entera entre 0 y 4294967295.');return;}saveWorld();applyWorld(generateWorld(seed));toast('Cielo generado. Exporta cada mundo que quieras conservar.');};
 $('export-world').onclick=()=>download(new Blob([JSON.stringify(world)],{type:'application/json'}),'Pleiade-mundo-'+world.seed+'.json');
 const worldPicker=$('import-world');
 if(window.PleiadeAndroid){worldPicker.onclick=e=>{e.preventDefault();window.PleiadeAndroid.openWorld();};}
 else{worldPicker.onchange=async()=>{const file=worldPicker.files[0];if(!file)return;try{if(file.size>1000000)throw Error('Archivo demasiado grande.');importWorldText(await file.text());}catch(e){toast(e.message);}finally{worldPicker.value='';}};}
 window.addEventListener('pagehide',saveWorld);

 const panel=open=>{$('panel').hidden=!open;$('settings').setAttribute('aria-expanded',open);};$('settings').onclick=()=>panel($('panel').hidden);$('close-panel').onclick=()=>panel(false);
 $('reset').onclick=resetCamera;$('plus').onclick=()=>camera.distance=Math.max(3,camera.distance*.83);$('minus').onclick=()=>camera.distance=Math.min(48,camera.distance*1.2);$('height').onclick=()=>{camera.pitch=camera.pitch>.65?.28:.95;camera.distance=camera.pitch>.65?28:15;};
 document.querySelectorAll('[data-scene]').forEach(b=>b.onclick=()=>{if(state.ready)useScene(b.dataset.scene);});
 for(const name of ['materials','shadows','shadowSoft','water','ssr','contact','animation'])$(name).onchange=()=>{state[name]=$(name).checked;};
 $('waves').onchange=()=>{state.waveStrength=Number($('waves').value);};
 $('quality').onchange=()=>setQuality($('quality').value);
 $('capture').onclick=()=>{if(!state.ready){toast('La escena aún no está disponible.');return;}capturePending=true;if(state.paused)render();};$('report').onclick=()=>download(new Blob([JSON.stringify(report(),null,2)],{type:'application/json'}),'Pleiade-tablet-informe.json');
 const pointers=new Map();let gesture=null;
 const snapshot=()=>{let p=[...pointers.values()];return p.length>1?{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),n:p.length}:p.length?{...p[0],n:1}:null;};
 canvas.onpointerdown=e=>{if(!state.ready)return;canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});gesture=snapshot();};
 canvas.onpointermove=e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const next=snapshot();if(gesture&&next.n===gesture.n){let dx=next.x-gesture.x,dy=next.y-gesture.y;if(next.n===1){camera.yaw-=dx*.006;camera.pitch=Math.max(skyView?-1.4:.07,Math.min(1.4,camera.pitch+dy*.006));}else{camera.distance=Math.max(3,Math.min(48,camera.distance*(gesture.d/Math.max(5,next.d))));const c=cameraFrame(),speed=camera.distance*.0015;camera.target=math.add(camera.target,math.add(math.scale(c.right,-dx*speed),math.scale([c.forward[0],0,c.forward[2]],dy*speed)));const edge=state.scene==='biomes'?43:state.scene==='shore'?38:15;camera.target[0]=Math.max(-edge,Math.min(edge,camera.target[0]));camera.target[2]=Math.max(-edge,Math.min(edge,camera.target[2]));if(state.scene==='biomes')camera.target[1]=activeBiome.height(camera.target[0],camera.target[2])+1;else if(state.scene==='shore')camera.target[1]=Math.max(.5,watershed.height(camera.target[0],camera.target[2])+.70);}}gesture=next;};
 const release=e=>{pointers.delete(e.pointerId);gesture=snapshot();};canvas.onpointerup=release;canvas.onpointercancel=release;canvas.onlostpointercapture=release;window.addEventListener('blur',()=>{pointers.clear();gesture=null;});canvas.addEventListener('wheel',e=>{e.preventDefault();camera.distance=Math.max(3,Math.min(48,camera.distance*Math.exp(e.deltaY*.001)));},{passive:false});
 canvas.addEventListener('keydown',e=>{if(e.key.startsWith('Arrow'))e.preventDefault();if(e.key==='ArrowLeft')camera.yaw+=.1;if(e.key==='ArrowRight')camera.yaw-=.1;if(e.key==='ArrowUp')camera.pitch=Math.min(1.4,camera.pitch+.1);if(e.key==='ArrowDown')camera.pitch=Math.max(skyView?-1.4:.07,camera.pitch-.1);});
 document.addEventListener('visibilitychange',()=>{lastTime=0;lastFrame=0;statTime=performance.now();statFrames=0;$('state').textContent=document.hidden?'En pausa':'Local';});
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();state.ready=false;state.errors.push('WebGL context lost');cancelAnimationFrame(frameRequest);$('status').hidden=false;$('status').querySelector('h2').textContent='La GPU ha pausado el visor';$('load-status').textContent='El navegador ha liberado la escena. Puedes recargar para continuar.';$('status').querySelector('.loader').hidden=true;$('retry').hidden=false;$('state').textContent='Pausado';});
 canvas.addEventListener('webglcontextrestored',()=>location.reload());
}
async function start(){setupUI();$('quality').value=state.quality;gl=canvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'low-power',preserveDrawingBuffer:false});if(!gl)throw Error(window.PleiadeAndroid?'WebGL 2 no está disponible. Comprueba si hay una actualización de Android System WebView.':'WebGL 2 no está disponible. Actualiza Brave o prueba Chrome; no necesitas desactivar las protecciones globales.');state.hdr=!!gl.getExtension('EXT_color_buffer_float');if(params.has('ldr'))state.hdr=false;
 $('format-note').textContent=state.hdr?'Iluminación HDR disponible.':'Modo compatible sin HDR: los brillos están limitados y el contacto ambiental se desactiva.';if(!state.hdr){$('contact').disabled=true;}
 $('load-status').textContent='Cargando materiales y geometría de Pléiade…';
 const data=await Promise.all([fetchData('assets/shaders.json'),fetchData('assets/scene.json'),fetchData('assets/manifest.json')]);let shaders=data[0];sceneData=data[1];manifest=data[2];programs.material=program(shaders.geometry,shaders.material);programs.shadow=program(shaders.geometry,shaders.shadow);programs.composite=program(shaders.fullscreen,shaders.composite);programs.cloud=program(shaders.fullscreen,shaders.cloud);
 programs.water=program(shaders.waterVertex,shaders.depthOnly);programs.glass=program(shaders.geometry,shaders.glass);
 programs.weather=program(shaders.weatherVertex,shaders.weather);
 const populations=[sceneData.shore,sceneData.building,...Object.values(sceneData.buildingForms),sceneData.snowCabin,...Object.values(sceneData.plants)];
 const needed=new Set(populations.flat().filter(o=>o.visible!==false).map(o=>o.mesh));needed.add(sceneData.meshIds.rock);needed.add(sceneData.meshIds.vine);
 for(const mesh of sceneData.meshes)if(needed.has(mesh.id)){
  if(mesh.far!==undefined)needed.add(mesh.far);
  if(mesh.mid!==undefined)needed.add(mesh.mid);
 }
 await Promise.all(sceneData.meshes.filter(m=>needed.has(m.id)).map(loadMesh));
 const layerInfo=await fetchData('assets/surfaces.json');
 const layerData=await Promise.all(['color','normal'].map(kind=>fetchData(`assets/surfaces-${kind}.rgba`,'buffer')));
 layerData.forEach((bytes,index)=>{
  const width=layerInfo.size,layers=layerInfo.layers.length,target=gl.TEXTURE_2D_ARRAY;
  if(bytes.byteLength!==width*width*layers*4)throw Error('El paquete de superficies está incompleto.');
  const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+14+index);gl.bindTexture(target,t);
  gl.texImage3D(target,0,index?gl.RGBA8:gl.SRGB8_ALPHA8,width,width,layers,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(bytes));
  gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.generateMipmap(target);
 });
 for(const p of [programs.material,programs.shadow]){
  gl.useProgram(p.id);ui(p,'uSurfaceColor',14);ui(p,'uSurfaceNormal',15);ui(p,'uSurfaceMaps',1);
 }
 for(const name of ['ground','bark','rock']){let bytes=new Uint8Array(await fetchData('assets/'+name+'.rgba','buffer'));for(let i=0;i<2;i++){let t=texture(512,512,i===0?gl.SRGB8_ALPHA8:gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,bytes.subarray(i*512*512*4,(i+1)*512*512*4),true);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);materialTextures.push(t);}}
 gl.useProgram(programs.material.id);['uGroundColor','uGroundNormal','uBarkColor','uBarkNormal','uRockColor','uRockNormal'].forEach((name,i)=>ui(programs.material,name,5+i));ui(programs.material,'uVisibility',11);visibilityTexture=texture(1,1,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));bind(visibilityTexture,11);
 gl.useProgram(programs.composite.id);['uDirect','uAmbient','uDepth','uNormal'].forEach((n,i)=>ui(programs.composite,n,i));emptyVAO=gl.createVertexArray();sceneFbo=gl.createFramebuffer();shadowFbo=gl.createFramebuffer();waterFbo=gl.createFramebuffer();resizeShadow();resize();uploadStars();useScene('shore');state.ready=true;render();$('status').hidden=true;$('state').textContent='Local';statTime=performance.now();frameRequest=requestAnimationFrame(tick);
 window.pleiade={state,report,render,gl,useScene,useBiome,setWaterMode,setBuildingForm,setClimate,impact,applyWorld,importWorldText,get world(){return world;},setAtmosphere({clouds=0,altitude=2,fov=62,reuse=true}={}){cloudReuse=reuse;cloudAmount=Math.max(0,Math.min(1,clouds));flightAltitude=Math.max(2,Math.min(6000,altitude));opticalFov=Math.max(8,Math.min(75,fov));skyView=true;},get camera(){return camera;},setQuality,setTime(t){state.paused=true;state.time=state.waveTime=t;render();},readPixels(){render();const p=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;}};
 if(params.has('test'))import('./test.js').then(m=>m.run(window.pleiade)).catch(fail);
}
start().catch(fail);
