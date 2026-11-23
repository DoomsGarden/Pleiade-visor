export const biomes = {
    forest: {title: 'Bosque templado', description: 'Pinos, píceas y abedules entre claros y helechos.',
             layer: 12, tint: [.83, .97, .78], view: [1, 2.0, -13, .48, .12, 24]},
    desert: {title: 'Desierto', description: 'Dunas, ondulaciones de arena y afloramientos dispersos.',
             layer: 9, tint: [1.04, 1.01, .96], view: [0, 0, -12, .43, .32, 30]},
    snow: {title: 'Montañas nevadas', description: 'Crestas de roca, nieve en las laderas y una cabaña en el valle.',
           layer: 10, tint: [1, .99, 1.02], view: [2, 5.1, -18, .10, .09, 43]},
    tropical: {title: 'Trópico', description: 'Palmeras, plantas de hoja ancha y helechos en suelo húmedo.',
               layer: 12, tint: [.74, .94, .69], view: [0, 2.1, -10, .31, .065, 19]},
    bamboo: {title: 'Bosque de bambú', description: 'Cañas con nudos, copas cruzadas y sotobosque.',
             layer: 12, tint: [.76, .94, .69], view: [0, 2.4, -9, .44, .10, 18]}
};
const clamp = x => Math.min(1, Math.max(0, x));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => clamp(t) ** 2 * (3 - 2 * clamp(t));
const extent = 78;
const snowCabin = [6, -13];

function hash(x) {
    x = Math.imul(x ^ x >>> 16, 0x7feb352d);
    x = Math.imul(x ^ x >>> 15, 0x846ca68b);
    return ((x ^ x >>> 16) >>> 0) / 4294967296;
}

function noise(x, z, seed) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const u = smooth(x - ix), v = smooth(z - iz);
    const at = (a, b) => hash(seed ^ Math.imul(a, 0x68bc21eb) ^ Math.imul(b, 0x02e5be93));
    return mix(mix(at(ix, iz), at(ix + 1, iz), u), mix(at(ix, iz + 1), at(ix + 1, iz + 1), u), v);
}

function terrainProfile(name, seed) {
    const ground = (x, z) => (noise(x * .069, z * .069, seed) - .5) * 2.7
        + (noise(x * .24, z * .24, seed ^ 591) - .5) * .72;
    if (name === 'desert') {
        const direction = hash(seed ^ 851) * .38 + .23;
        return (x, z) => {
            const crosswind = x * Math.cos(direction) + z * Math.sin(direction);
            const parallel = -x * Math.sin(direction) + z * Math.cos(direction);
            const drift = noise(parallel * .027, crosswind * .023, seed) * 5.5 + Math.sin(parallel * .089) * .8;
            const phase = crosswind * .16 + drift;
            const dune = .5 + .44 * Math.sin(phase) + .064 * Math.sin(2 * phase + .87);
            const sand = noise(x * .026, z * .026, seed ^ 891);
            return ground(x, z) * .51 + Math.max(0, dune) ** 1.75 * (2.6 + sand * 5.8);
        };
    }
    if (name === 'snow') {
        // Individual massifs overlap to produce ridges with broad shoulders and passes.
        const summits = [
            [-65, -47, 22, 27, 21, 1.0], [-40, -59, 29, 27, 26, .63],
            [-15, -58, 36, 24, 22, 1.45], [7, -66, 19, 30, 21, .78],
            [34, -56, 31, 33, 26, .95], [60, -46, 24, 23, 25, .60],
            [-51, -28, 10, 26, 19, .62], [39, -34, 12, 21, 17, 1.05]
        ].map(([x,z,h,w,d,shape], i) => [x + (hash(seed^Math.imul(i+2,723))- .5) * 7,
            z + (hash(seed^Math.imul(i+2,557))-.5)*6, h*(.88+.22*hash(seed^Math.imul(i+2,907))),w,d,shape]);
        const raw = (x, z) => {
            const xx = x + (noise(x*.037, z*.045, seed ^ 931)-.5)*6;
            let ridge = 0;
            for (const [cx,cz,h,w,d,shape] of summits) {
                const dx=(xx-cx)/w, dz=(z-cz)/d + .20*dx;
                const mass = h * Math.max(0, 1 - (dx*dx+dz*dz)**shape)**1.68;
                const blend = Math.max(0, 2.6 - Math.abs(ridge - mass))/2.6;
                ridge = Math.max(ridge,mass) + .65*blend*blend;
            }
            const gully = noise(x*.144+z*.087,z*.078,seed ^ 133)-.56;
            return .5 + ground(x,z)*.65 + ridge*.80 + smooth(ridge/13)*(gully*2.7 + (noise(x*.23,z*.22,seed^411)-.5)*.72);
        };
        const padHeight = raw(...snowCabin);
        return (x, z) => {
            const d = Math.hypot(x - snowCabin[0], z - snowCabin[1]);
            return mix(padHeight + .045 * (x - snowCabin[0]), raw(x, z), smooth((d - 4.4) / 4.8));
        };
    }
    if (name === 'tropical')
        return (x, z) => ground(x, z) + 4.8 * noise(x * .028, z * .029, seed ^ 107) ** 2;
    return ground;
}

export function terrainPieces(profile, seed, cells = 28, order) {
    const side = cells + 1, width = extent * 2 / 3, step = width / cells, offset = step * .38;
    const indices = new Uint32Array(cells * cells * 6);
    let index = 0;
    for (let iz = 0; iz < cells; iz++)
        for (let ix = 0; ix < cells; ix++) {
            const a = iz * side + ix, b = a + side;
            indices.set([a, b, a + 1, a + 1, b, b + 1], index);
            index += 6;
        }
    const variants=order??Array.from({length:9},(_,i)=>i).sort((a,b)=>hash(seed^Math.imul(a+1,3991))-hash(seed^Math.imul(b+1,3991)));
    if(variants.length!==9||new Set(variants).size!==9||variants.some(i=>!Number.isInteger(i)||i<0||i>8))
        throw new RangeError('Se necesitan las nueve variantes del terreno');
    function relief(x,z) {
        const u=(x+extent)/width, v=(z+extent)/width;
        if(u<0||u>=3||v<0||v>=3)return profile(x,z);
        const col=Math.floor(u), row=Math.floor(v), dx=u-col, dz=v-row;
        const edge=Math.min(dx,1-dx,dz,1-dz);
        const variant=variants[row*3+col];
        return profile(x,z) + smooth((edge-.055)/.22)*(.48+.056*variant)*
            (noise(dx*(4+variant*.33),dz*(4.6+variant*.28),seed^Math.imul(variant+1,813))-.5);
    }
    const pieces = variants.map((variant, tile) => {
        const col=tile%3,row=Math.floor(tile/3),vertices=new Float32Array(side*side*8);
        for(let iz=0;iz<=cells;iz++) for(let ix=0;ix<=cells;ix++) {
            // Global integer coordinates produce bit-identical positions and normals on shared edges.
            const gx=col*cells+ix,gz=row*cells+iz,x=-extent+gx*step,z=-extent+gz*step;
            const dx=(relief(x+offset,z)-relief(x-offset,z))/(2*offset);
            const dz=(relief(x,z+offset)-relief(x,z-offset))/(2*offset);
            const unit=1/Math.hypot(dx,1,dz);
            vertices.set([x,relief(x,z),z,-dx*unit,unit,-dz*unit,gx/(3*cells),gz/(3*cells)], (iz*side+ix)*8);
        }
        return {id:`biome-ground-${tile}`,variant,vertices,indices};
    });
    function surfaceHeight(x,z) {
        const u=(x+extent)/step,v=(z+extent)/step;
        if(u<0||u>3*cells||v<0||v>3*cells)return profile(x,z);
        const col=Math.min(2,Math.floor(u/cells)),row=Math.min(2,Math.floor(v/cells));
        const lx=u-col*cells,lz=v-row*cells;
        const ix=Math.min(cells-1,Math.floor(lx)),iz=Math.min(cells-1,Math.floor(lz));
        const dx=lx-ix,dz=lz-iz,a=(iz*side+ix)*8+1,b=a+side*8;
        const {vertices}=pieces[row*3+col];
        return dx+dz<=1?vertices[a]*(1-dx-dz)+vertices[a+8]*dx+vertices[b]*dz:
            vertices[b+8]*(dx+dz-1)+vertices[a+8]*(1-dz)+vertices[b]*(1-dx);
    }
    return {pieces,surfaceHeight};
}

function matrix(x, y, z, sx, sy, sz, angle = 0) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [sx*c,0,-sx*s,0, 0,sy,0,0, sz*s,0,sz*c,0, x,y,z,1];
}

export function copyPrototype(objects, prototype, x, y, z, size, angle, tint, distant) {
    if (!prototype) return;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const part of prototype) {
        if (part.visible === false || (distant && part.detail && part.section !== 7)) continue;
        const pose = part.instance.slice();
        for (let column = 0; column < 16; column += 4) {
            const px = pose[column], pz = pose[column + 2];
            pose[column] = size * (c * px + s * pz);
            pose[column + 1] *= size;
            pose[column + 2] = size * (-s * px + c * pz);
        }
        pose[12] += x;
        pose[13] += y;
        pose[14] += z;
        for (let i = 16; i < 19; i++) pose[i] *= tint;
        objects.push({mesh: part.mesh, detail: part.detail, section: part.section, instance: pose});
    }
}

function secondaryVegetation(type, seed, x, z) {
    if (type === 'tropical' || type === 'bamboo') return 'fern';
    return noise(x * .11, z * .11, seed ^ 467) > .56 ? 'fern' : 'juniper';
}

function selectCanopy(type, habitat, choice) {
    if (type === 'bamboo') return 'bamboo';
    if (type === 'tropical') return choice < .52 + .15 * habitat ? 'palm' : 'tropicalTree';
    if (type === 'snow') return 'spruce';
    return habitat > .57 && choice > .33 ? 'birch' : choice > .57 ? 'pine' : 'spruce';
}

function addVine(objects, mesh, from, to, diameter) {
    const axis = to.map((v, i) => v - from[i]);
    const span = Math.hypot(...axis);
    const [x, y, z] = axis.map(v => v / span);
    const lateral = Math.hypot(x, z);
    const [rx, rz] = lateral > .001 ? [-z / lateral, x / lateral] : [1, 0];
    const stride = span + diameter * .5;
    objects.push({mesh, instance: [
        rx * diameter, 0, rz * diameter, 0, x * stride, y * stride, z * stride, 0,
        -rz * y * diameter, (rz * x - rx * z) * diameter, rx * y * diameter, 0,
        ...from.map((v, i) => (v + to[i]) * .5), 1, .67, .82, .58, 1, .86, 0, 25, 0
    ]});
}

function connectVines(objects, mesh, hosts, seed, height) {
    const trees=hosts.map(host=>host.crown);
    const degrees = trees.map(() => 0);
    const neighbors = [];
    for (let i = 0; i < trees.length; i++)
        for (let j = i + 1; j < trees.length; j++) {
            const [a, b] = [trees[i], trees[j]];
            const distance = Math.hypot(b[0] - a[0], b[2] - a[2]);
            if (distance >= 2.4 && distance <= 9.8 && Math.abs(b[1] - a[1]) < 4)
                neighbors.push({i, j, distance});
        }
    neighbors.sort((a, b) => a.distance - b.distance);

    function curve(a, b, sag, twines, phase) {
        const sideways = [a[2] - b[2], b[0] - a[0]];
        const length = Math.hypot(...sideways);
        const [nx, nz] = length < .01 ? [1, 0] : sideways.map(v => v / length);
        const points = 9 + twines * 3;
        let previous = a;
        for (let step = 1; step <= points; step++) {
            const t = step / points, middle = Math.sin(Math.PI * t);
            const turn = phase + t * (twines ? 13 : 5);
            const offset = Math.sin(turn) * middle * (twines ? .116 : .135);
            const point = [mix(a[0], b[0], t) + nx * offset,
                           mix(a[1], b[1], t) - sag * middle + .052 * middle * Math.cos(turn),
                           mix(a[2], b[2], t) + nz * offset];
            addVine(objects, mesh, previous, point, (twines ? .042 : .055) * (1 - .29 * t));
            previous = point;
        }
    }

    let links = 0, hanging = 0;
    for (const {i, j, distance} of neighbors) {
        if (links>=28 || degrees[i] >= 2 || degrees[j] >= 2 || hash(seed ^ Math.imul(i+2,j+137)) < .33) continue;
        const [a, b] = [trees[i], trees[j]];
        const phase = hash(seed ^ Math.imul(i + 1, j + 433)) * Math.PI * 2;
        const entwined = distance < 7.3 && (degrees[i] || degrees[j] || phase < 2.3);
        curve(a, b, .19 * distance, entwined, phase);
        if (entwined) curve(a, b, .19 * distance + .014, entwined, phase + Math.PI);
        degrees[i]++; degrees[j]++; links++;
    }
    let climbing = 0;
    for (const [i, host] of hosts.entries()) {
        const a=host.crown;
        const side=hash(seed ^ Math.imul(i+1,851));
        const angle=2*Math.PI*side;
        if(degrees[i]===0 || side>.69) {
            const reach=.45+side*1.1, dx=Math.cos(angle), dz=Math.sin(angle);
            const tip=[a[0]+dx*reach,a[1]-1.0-side*2.9,a[2]+dz*reach];
            curve(a,tip,.12+.24*side,false,angle);
            hanging++;
        }
        if(side>.46) {
            const [x,y,z]=host.base;
            const rootOffset=host.radius+.34+side*.39;
            const rootX=x+Math.cos(angle)*rootOffset,rootZ=z+Math.sin(angle)*rootOffset;
            let previous=[rootX,height(rootX,rootZ)-.10,rootZ];
            const rise=a[1]-y, turns=1.3+side*1.7, segments=22;
            for(let step=1;step<=segments;step++) {
                const t=step/segments, heading=angle+t*turns*2*Math.PI;
                const radial=host.radius*(1-.66*t)+.035+(1-smooth(t*7))*.22;
                const point=[mix(x,a[0],t)+Math.cos(heading)*radial,
                             y+t*rise, mix(z,a[2],t)+Math.sin(heading)*radial];
                addVine(objects,mesh,previous,point,.068*(1-.55*t));
                previous=point;
            }
            climbing++;
        }
    }
    return {links,hanging,climbing};
}

function forestPositions(name, seed, height) {
    const groveCount={forest:19,tropical:17,bamboo:21,snow:13}[name];
    const limit={forest:144,tropical:113,bamboo:111,snow:56}[name];
    const positions=[];
    for(let i=0;i<850 && positions.length<limit;i++) {
        const group=i%groveCount + 1;
        const centerSeed=seed^Math.imul(group,131577);
        const sampleSeed=seed^Math.imul(i+27,92071);
        const centerX=mix(-64,64,hash(centerSeed^899)), centerZ=mix(-66,42,hash(centerSeed^674));
        const heading=hash(sampleSeed^37992)*Math.PI*2;
        const radius=Math.sqrt(hash(sampleSeed^80789))*(name==='bamboo'?9:14);
        const x=centerX+Math.cos(heading)*radius,z=centerZ+Math.sin(heading)*radius;
        if(Math.abs(x)>70||z< -71||z>51)continue;
        const moisture=noise(x*.034,z*.039,seed^555);
        const gap=noise(x*.048,z*.052,seed^9871);
        const y=height(x,z);
        const slope=Math.hypot(height(x+1,z)-y,height(x,z+1)-y);
        const sizeFactor=hash(sampleSeed^822);
        const established=hash(sampleSeed^8111)>.24;
        const min=(name==='bamboo'?1.35:name==='tropical'?2.65:2.6)*(established?1.12:.72);
        const habitat=gap>.29&&slope<.86;
        if(!habitat||positions.some(p=>Math.hypot(x-p.x,z-p.z)<min+p.clearance))continue;
        if(name==='snow'&&(y>8.4||Math.hypot(x-snowCabin[0],z-snowCabin[1])<7.5))continue;
        const base={bamboo:6.4,tropical:8.2,forest:8.1,snow:5.1}[name];
        const size=established ? base*(.72+sizeFactor*.83) : base*(.26+sizeFactor*.42);
        positions.push({x,y,z,size,clearance:min*.46,moisture,choice:hash(sampleSeed^22918),key:sampleSeed});
    }
    return positions;
}

export function createBiome(name, seed, data) {
    const biome = biomes[name];
    if (!biome) throw new RangeError('Bioma desconocido');
    const terrain=terrainPieces(terrainProfile(name,seed),seed,name==='snow'?36:28);
    const height=terrain.surfaceHeight;
    const objects=terrain.pieces.map(tile=>({mesh:tile.id,instance:[
        ...matrix(0,0,0,1,1,1), ...biome.tint,1,.93,0,40+biome.layer,0
    ]}));
    const hosts=[];
    const trees=name==='desert'?[]:forestPositions(name,seed,height);
    let plants=trees.length,rocks=0,understory=0;
    for(const {x,y,z,size,moisture,choice,key} of trees) {
        const kind=selectCanopy(name,moisture,choice);
        const angle=hash(key^573)*Math.PI*2;
        const distance=Math.hypot(x-2,z+12);
        const tint=.82+moisture*.27;
        const prototype=data.plants[kind+(key%2===0?'2':'')]??data.plants[kind];
        copyPrototype(objects,prototype,x,y-.09,z,size,angle,tint,distance>27);
        if(name==='tropical'&&size>4.5) {
            const palm=kind==='palm';
            const dx=palm?Math.cos(angle)*.050+Math.sin(angle)*-.014:0;
            const dz=palm?-Math.sin(angle)*.050+Math.cos(angle)*-.014:0;
            hosts.push({base:[x,y,z],crown:[x+dx*size,y+size*(palm?.89:.71),z+dz*size],
                        radius:size*(palm?.019:.038)});
        }
        if(name!=='snow'&&distance<39&&hash(key^9132)>.33) {
            const count=name==='tropical'?3:2;
            for(let j=0;j<count;j++) {
                const spread=angle+j*2.43, reach=.55+hash(key^Math.imul(j+1,354))*(2.2+j*.35);
                const px=x+Math.cos(spread)*reach,pz=z+Math.sin(spread)*reach;
                const plant=secondaryVegetation(name,seed,px,pz);
                copyPrototype(objects,data.plants[plant],px,height(px,pz)-.02,pz,
                              .58+moisture*.75,spread,.89+moisture*.17,distance>24);
                understory++;
            }
        }
    }
    for(let i=0;i<36;i++) {
        const key=seed^Math.imul(i+2,33721), x=mix(-60,60,hash(key^993)),z=mix(-69,41,hash(key^8434));
        if(name==='snow'&&Math.hypot(x-snowCabin[0],z-snowCabin[1])<9)continue;
        const width=.36+hash(key^953)*(name==='snow'?3.1:1.42);
        const depth=width*(.79+.35*hash(key^4355)),h=width*(.43+.36*hash(key^722));
        const tint=.71+.31*hash(key^901);
        objects.push({mesh:data.meshIds.rock,instance:[
            ...matrix(x,height(x,z)-h*.075,z,width,h,depth,hash(key^681)*Math.PI*2),
            tint,tint*.99,tint*.95,1,.84,0,31,0
        ]});
        rocks++;
    }
    if (name === 'snow')
        copyPrototype(objects,data.snowCabin,snowCabin[0],height(...snowCabin),snowCabin[1],.91,-.18,1,false);
    const vines=name==='tropical'?connectVines(objects,data.meshIds.vine,hosts,seed,height):null;
    return {height,terrain,objects,plants:plants+understory,trees:trees.length,understory,rocks,vines};
}
