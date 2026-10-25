#!/usr/bin/env python3
"""Large synthetic probes using the actual frozen resampling-index matrices.

Integer-valued float32 GEMM computes sampled-success counts exactly. An explicit
1e-10 endpoint enclosure allows arithmetic reordering relative to JS. This is
targeted simulation with MC uncertainty, not an exact coverage theorem/full grid.
"""
import os
os.environ['OPENBLAS_NUM_THREADSS']='1'
os.environ['OPENBLAS_NUM_THREADS']='1'
os.environ['OMP_NUM_THREADS']='1'
import json,math,hashlib,subprocess,time,importlib.util
from pathlib import Path
from fractions import Fraction as F
import numpy as np
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('base',ROOT/'a5-structural-r1.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
N=100000;BATCH=128;EPS=1e-10
NODE="""import {writeFileSync} from 'node:fs';
import {random} from '__RANDOM_MODULE__';
const [path,ls,ms]=process.argv.slice(1),L=Number(ls),m=Number(ms),n=L*m;
const a=new Uint8Array(10000*n),rng=random('hr3-bootstrap-v1');
for(let b=0;b<10000;b++)for(let l=0;l<L;l++)for(let i=0;i<m;i++)a[b*n+l*m+rng.int(m)]++;
writeFileSync(path,a);"""
NODE=NODE.replace('__RANDOM_MODULE__',(ROOT.parent/'random.mjs').as_uri())

def main():
    start=time.monotonic();report={'method':__doc__,'datasets_per_case':N,'rows':[],'epsilon':EPS,
                                  'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    tasks=[('development-within-homogeneous-C',50,4,0,40,[F('.4')]*40),
           ('development-within-correction-C',50,4,0,40,[F('.2')]*40),
           ('development-within-reversal-C',50,4,40,40,[F('.3')]*40),
           ('development-within-scope-C',50,4,120,40,[F('.5')]*40),
           ('development-overall-homogeneous-J',50,4,0,200,[F('.064')]*200),
           ('test-within-reversal-J',200,8,320,320,[F('.027')]*320)]
    matrix=None;last=None
    for label,L,m,offset,n,ps in tasks:
        if (L,m)!=last:
            split='development' if L==50 else 'test';path=ROOT/f'a5-frozen-counts-{split}.u8'
            subprocess.run(['node','--input-type=module','-e',NODE,str(path),str(L),str(m)],check=True)
            raw=np.fromfile(path,dtype=np.uint8).reshape(10000,L*m)
            assert np.all(raw.reshape(10000,L,m).sum(axis=2)==m)
            matrix=raw;last=(L,m)
        C=np.ascontiguousarray(matrix[:,offset:offset+n],dtype=np.float32)
        rng=np.random.default_rng(int.from_bytes(hashlib.sha256(('hr3-a5-fixed-r1/'+label).encode()).digest()[:16],'little'))
        mu=sum(ps,F(0))/n;truth=float(mu);p=np.array(list(map(float,ps)))
        c=math.sqrt(m/(m-1));inner=outer=0
        for begin in range(0,N,BATCH):
            batch=min(BATCH,N-begin)
            X=(rng.random((batch,n))<p).astype(np.float32).T
            S=X.sum(axis=0,dtype=np.float64)
            Y=C@X
            assert np.all(Y==np.floor(Y))
            q=np.partition(Y,[249,250,9749,9750],axis=0)
            kl=q[249].astype(float)*.025+q[250].astype(float)*.975
            ku=q[9749].astype(float)*.975+q[9750].astype(float)*.025
            lo=(S+c*(kl-S))/n;hi=(S+c*(ku-S))/n
            inside=(lo+EPS<=truth)&(hi-EPS>=truth)
            maybe=(lo-EPS<=truth)&(hi+EPS>=truth)
            zeros=S==0;ones=S==n
            inside[zeros]=maybe[zeros]=base.boundary_covers(mu,n,False)
            inside[ones]=maybe[ones]=base.boundary_covers(mu,n,True)
            inner+=int(inside.sum());outer+=int(maybe.sum())
            if begin and begin%12800==0: print(label,'datasets',begin,flush=True)
        row={'id':label,'n':n,'m':m,'datasets':N,'lower_coverage_estimate':inner/N,'upper_coverage_estimate':outer/N,
             'mc95_enclosure':[base.wilson(inner,N)[0],base.wilson(outer,N)[1]],
             'frozen_index_sha256':hashlib.sha256(matrix.tobytes()).hexdigest()}
        report['rows'].append(row);report['elapsed_seconds']=time.monotonic()-start
        (ROOT/'a5-fixed-matrix-r1-results.json').write_text(json.dumps(report,indent=2)+'\n')
        print('RESULT',label,row,flush=True)
    report['complete']=True
    (ROOT/'a5-fixed-matrix-r1-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print('COMPLETE',flush=True)

if __name__=='__main__': main()
