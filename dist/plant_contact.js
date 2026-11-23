const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

// Forces are sandbox units. The rigid piece is selected by the closest swept branch span.
export function plantContact(objects,point,impulse){
    if (![...point,...impulse].every(Number.isFinite))return null;
    let root=-1,best=Infinity;
    for(let i=0;i<objects.length;i++){
        const part=objects[i];
        if(!(part.section>=4&&part.section<=6)||part.visible===false)continue;
        const m=part.instance,p=m.slice(12,15),axis=m.slice(4,7),offset=sub(point,p);
        const u=Math.min(.5,Math.max(-.5,dot(offset,axis)/dot(axis,axis)));
        const distance=Math.hypot(...offset.map((v,k)=>v-u*axis[k]));
        const radius=Math.hypot(...m.slice(0,3))*.5;
        const length=Math.hypot(...axis);
        if(distance>radius+.115||distance>=best)continue;
        const bend=Math.hypot(...cross(axis,impulse))/length;
        if(bend<.18+radius*radius*11)continue;
        root=i;best=distance;
    }
    if(root<0)return null;
    const pieces=new Set([root]);
    for(let i=root+1;i<objects.length;i++){
        const part=objects[i];
        if(part.section===1)break;
        if(part.parentDistance&&pieces.has(i-part.parentDistance))pieces.add(i);
    }
    return {pieces,point:point.slice(),velocity:impulse.map(v=>v*.56)};
}

export function moveDetached(objects,contact,age,ground){
    if(!contact)return objects;
    const {pieces,point,velocity}=contact, t=Math.min(1.9,Math.max(0,age));
    const drift=Math.min(t,.79);
    const dx=velocity[0]*drift,dz=velocity[2]*drift;
    const drop=velocity[1]*t-2.7*t*t;
    const yaw=t*Math.min(1.45,.36+Math.hypot(velocity[0],velocity[2])*.44);
    const c=Math.cos(yaw),s=Math.sin(yaw);
    return objects.map((part,i)=>{
        if(!pieces.has(i))return part;
        const pose=part.instance.slice();
        for(let col=0;col<12;col+=4){
            const x=pose[col],z=pose[col+2];pose[col]=x*c+z*s;pose[col+2]=z*c-x*s;
        }
        const x=pose[12]-point[0],z=pose[14]-point[2];
        pose[12]=point[0]+x*c+z*s+dx;pose[14]=point[2]+z*c-x*s+dz;
        pose[13]=Math.max(ground(pose[12],pose[14])+.09,pose[13]+drop);
        return {...part,instance:pose};
    });
}
