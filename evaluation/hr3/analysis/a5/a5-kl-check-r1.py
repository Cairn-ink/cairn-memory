#!/usr/bin/env python3
"""Synthetic carrier coverage check; no validation-grid or research data."""
import os
os.environ['OPENBLAS_NUM_THREADS']='1'
import json,math,hashlib,importlib.util
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('base',ROOT/'a5-structural-r1.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)

def main():
    out=[]
    for case in base.cases():
        if case['split']=='pilot': continue
        ps=[float(p) for p in case['probabilities'] for _ in range(case['m'])]
        n=len(ps);mu=sum(ps)/n
        pmf=np.ones(1)
        for p in ps:
            q=np.zeros(len(pmf)+1);q[:-1]+=(1-p)*pmf;q[1:]+=p*pmf;pmf=q
        assert abs(pmf.sum()-1)<1e-11
        k=np.arange(n+1);x=k/n
        kl=np.zeros(n+1)
        left=x>0;right=x<1
        kl[left]+=x[left]*np.log(x[left]/mu)
        kl[right]+=(1-x[right])*np.log((1-x[right])/(1-mu))
        covered=n*kl<=math.log(40)+1e-12
        coverage=float(pmf[covered].sum())
        assert coverage>=.95-1e-10
        out.append({'id':case['id'],'n':n,'truth':str(sum(case['probabilities'],base.F(0))/len(case['probabilities'])),
                    'carrier_coverage_enumerated_binary64':coverage,
                    'analytic_independent_bernoulli_guarantee':.95})
    report={'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'method':'Poisson-binomial count DP numeric check; >=.95 guarantee follows separately from Chernoff/AM-GM proof, not these floating values',
            'rows':out,'minimum_numeric_carrier_coverage':min(r['carrier_coverage_enumerated_binary64'] for r in out),'complete':True}
    (ROOT/'a5-kl-check-r1-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print('PASS',len(out),'development/test unique configurations; minimum numeric carrier coverage',report['minimum_numeric_carrier_coverage'])

if __name__=='__main__':main()
