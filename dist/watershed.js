const clamp=x=>Math.min(1,Math.max(0,x));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t);};
const mix=(a,b,w)=>a+(b-a)*w;
const extent=52;
export const waterModes=['lake','river','falls'];

export function channel(z){
    return -3.3 + 3.1*Math.sin(z*.056) + 1.3*Math.sin(z*.133+.9);
}

export function lakeBank(z){
    return 1.60*Math.sin(z*.091)+.68*Math.sin(z*.19);
}

export function waterBase(mode,z){
    if(mode==='lake')return 0;
    return .44+z*.010+(mode==='falls'?3.65*smooth((z+2.5)/4.2):0);
}

function bedProfile(mode,seed){
    const grain=(seed%1301)*.003;
    return (x,z)=>{
        const rough=.18*Math.sin(x*.39+z*.27+grain)*Math.sin(z*.44-x*.41);
        const hills=.83*Math.sin(x*.097+grain)*Math.sin(z*.111)+.48*Math.sin(z*.074-x*.081);
        if(mode==='lake'){
            const inland=x-lakeBank(z);
            return .075*inland + smooth(inland/7)*hills + rough*.64;
        }
        const offset=Math.abs(x-channel(z));
        const inner=-1.03+.12*Math.sin(z*.22),bank=.66+hills*.38;
        return waterBase(mode,z)+mix(inner,bank,smooth((offset-2.05)/2.36))+
            .73*smooth((offset-4.6)/8)*hills+rough*.48;
    };
}

function mesh(columns, rows, sample){
    const stride=columns+1;
    const vertices=new Float32Array((rows+1)*stride*8);
    const indices=new Uint32Array(rows*columns*6);
    for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++)
        vertices.set(sample(i/columns,j/rows),(j*stride+i)*8);
    for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){
        const a=j*stride+i,b=a+stride;
        indices.set([a,b,a+1,a+1,b,b+1],(j*columns+i)*6);
    }
    return {vertices,indices};
}

export function createWatershed(mode,seed){
    if(!waterModes.includes(mode))throw new RangeError('Cuenca desconocida');
    const profile=bedProfile(mode,seed);
    const cells=144;
    const land=mesh(cells,cells,(u,v)=>{
        const x=(u*2-1)*extent,z=(v*2-1)*extent,d=.24;
        const dx=(profile(x+d,z)-profile(x-d,z))/(2*d),dz=(profile(x,z+d)-profile(x,z-d))/(2*d);
        const n=1/Math.hypot(dx,1,dz);
        return [x,profile(x,z),z,-dx*n,n,-dz*n,u,v];
    });
    function height(x,z){
        const u=clamp((x+extent)/(2*extent))*cells;
        const v=clamp((z+extent)/(2*extent))*cells;
        const i=Math.min(cells-1,Math.floor(u)),j=Math.min(cells-1,Math.floor(v));
        const a=(j*(cells+1)+i)*8+1,b=a+(cells+1)*8,du=u-i,dv=v-j;
        const p=land.vertices;
        return du+dv<=1 ? p[a]*(1-du-dv)+p[a+8]*du+p[b]*dv :
            p[b+8]*(du+dv-1)+p[a+8]*(1-dv)+p[b]*(1-du);
    }
    const water=mesh(mode==='lake'?100:22,208,(u,v)=>{
        let z=2*extent*v-extent;
        if(mode==='falls'){
            // Concentrate rows where the surface bends over the lip.
            z=v<.38?mix(-extent,-5,v/.38):
                v<.62?mix(-5,4,(v-.38)/.24):mix(4,extent,(v-.62)/.38);
        }
        let x;
        if(mode==='lake'){
            // Keep a dense strip across the curved shoreline and a coarser
            // grid on the far side. The strip extends past the wet ground.
            const bank=lakeBank(z);
            x=u<.59?mix(-extent,bank-7.0,u/.59):mix(bank-7.0,bank+3.5,(u-.59)/.41);
        }else{
            x=channel(z)+(2*u-1)*4.52;
        }
        return [x,waterBase(mode,z),z,0,1,0,u,v];
    });
    return {land,water,height,area:extent*2};
}

// Periodic transport of floaters, measured in world metres. The chute accelerates them.
export function driftSamples(mode,time,count=10){
    const particles=new Float32Array(count*3);
    if(mode==='lake')return particles;
    for(let i=0;i<count;i++){
        const phase=(i*.61803398875+time/(mode==='falls'?47:56))%1;
        let z;
        if(mode==='falls'){
            if(phase<.55)z=mix(39,2.6,phase/.55);
            else if(phase<.59)z=mix(2.6,-3.6,(phase-.55)/.04);
            else z=mix(-3.6,-39,(phase-.59)/.41);
        }else z=mix(39,-39,phase);
        const offset=1.75*Math.sin(i*5.1)+.21*Math.sin(z*.19+i);
        particles.set([channel(z)+offset,waterBase(mode,z),z],i*3);
    }
    return particles;
}
