#!/usr/bin/env python3
"""Synthetic A-5 structural checks; writes only beside this script.

Exact state enumeration gives a *coverage upper bound*, not attained percentile
coverage. Large targeted simulation separately bounds coverage of 10,000 fresh
bootstrap draws using exact order-statistic implications and FFT conditional
CDFs. It does not certify the protocol's one fixed resampling matrix/full grid.
"""
import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
import hashlib, json, math, platform, sys, time
from collections import defaultdict
from decimal import Decimal, localcontext, ROUND_CEILING
from fractions import Fraction as F
from itertools import product
from pathlib import Path
import numpy as np
import scipy
from scipy.special import bdtr

ROOT = Path(__file__).resolve().parent
N_SIM, B, BATCH = 100000, 10000, 256
SEED = 'hr3-a5-structural-r1-targeted-v1'
TYPES = ['correction','reversal','refinement','scope_change','expiry']
P = list(map(F,['.2','.3','.4','.5','.6']))
ALLOC = {'pilot':(6,2),'development':(10,4),'test':(40,8)}
START = time.monotonic()

def sign_positive(a,b,m):
    # Exact sign of a + b*sqrt(m/(m-1)); a,b are integers.
    if a >= 0 and b >= 0: return a > 0 or b > 0
    if a <= 0 and b <= 0: return False
    return b*b*m > a*a*(m-1) if b > 0 else a*a*(m-1) > b*b*m

def boundary_covers(mu,n,ones):
    a,b=mu.numerator,mu.denominator
    return 40*(a if ones else b-a)**n >= b**n

def q_integer(p,m):
    a,b=p.numerator,p.denominator
    return [math.comb(m,k)*a**k*(b-a)**(m-k) for k in range(m+1)],b**m

def exact_lower_miss(ps,m):
    """Joint distribution of (all-one lineages, total successes), integer DP."""
    L,n=len(ps),len(ps)*m
    mu=sum(ps,F(0))/L
    d={(0,0):1}; den=1
    for p in ps:
        qs,b=q_integer(p,m); den*=b; out=defaultdict(int)
        for (j,s),v in d.items():
            for k,q in enumerate(qs): out[j+(k==m),s+k] += v*q
        d=out
    assert sum(d.values())==den
    fail=0
    for (j,s),v in d.items():
        if s==n and boundary_covers(mu,n,True): continue
        a=s*mu.denominator-n*mu.numerator
        b=(m*j-s)*mu.denominator
        if sign_positive(a,b,m): fail+=v
    return F(fail,den),len(d)

def float_lower_miss(ps,m):
    """Same full state enumeration with an explicit positive-arithmetic bound.

    All coefficients are correctly rounded exact Fractions. Every operation is
    nonnegative. gamma(total executed scalar operations) conservatively bounds
    relative rounding, even without assuming pairwise summation. Gradual
    underflow adds at most operations*minimum_subnormal. Predicate signs are
    evaluated by integer arithmetic, not floating point.
    """
    L,n=len(ps),len(ps)*m; mu=sum(ps,F(0))/L
    d=np.ones((1,1)); ops=0
    for t,p in enumerate(ps):
        qs,den=q_integer(p,m)
        out=np.zeros((t+2,m*(t+1)+1))
        for k,q in enumerate(qs):
            c=float(F(q,den)); j=int(k==m)
            out[j:j+t+1,k:k+m*t+1] += c*d
            ops+=2*d.size+1
        d=out
    jj=np.arange(L+1,dtype=np.int64)[:,None]
    ss=np.arange(n+1,dtype=np.int64)[None,:]
    a=ss*mu.denominator-n*mu.numerator
    b=(m*jj-ss)*mu.denominator
    mask=((a>=0)&(b>=0)&((a>0)|(b>0))) | ((a<0)&(b>0)&(b*b*m>a*a*(m-1))) | ((a>0)&(b<0)&(a*a*(m-1)>b*b*m))
    if boundary_covers(mu,n,True): mask[L,n]=False
    f=float(d[mask].sum()); ops+=d.size
    assert abs(float(d.sum())-1)<1e-10
    u=2.0**-53; gamma=ops*u/(1-ops*u)
    tiny=Decimal.from_float(float(np.nextafter(0.,1.)))
    with localcontext() as ctx:
        ctx.prec=90
        lower=max(Decimal(0),Decimal.from_float(f)/(1+Decimal.from_float(gamma))-ops*tiny)
        upper=min(Decimal(1),Decimal.from_float(f)/(1-Decimal.from_float(gamma))+ops*tiny)
    return lower,upper,ops

def decimal_fraction(x):
    with localcontext() as ctx:
        ctx.prec=90
        return Decimal(x.numerator)/Decimal(x.denominator)

def structural(ps,m):
    # Disjoint lower/upper range misses; upper is lower after flipping all bits.
    ps=tuple(sorted(ps)); mirror=tuple(sorted(1-p for p in ps)); n=len(ps)*m
    if n<=400:
        a,states=exact_lower_miss(ps,m); b,_=exact_lower_miss(mirror,m)
        fail=a+b; cap=1-fail
        return {'method':'exact integer state enumeration','failure_fraction':str(fail),
                'failure_lower':str(decimal_fraction(fail)), 'failure_upper':str(decimal_fraction(fail)),
                'coverage_cap_upper':str(decimal_fraction(cap)), 'states':states,
                'cap_below_93':cap<F(93,100)}
    a,b,ops=float_lower_miss(ps,m); c,d,ops2=float_lower_miss(mirror,m)
    with localcontext() as ctx:
        ctx.prec=90
        lo=max(Decimal(0),a+c); hi=min(Decimal(1),b+d)
        cap=(Decimal(1)-lo).quantize(Decimal('1e-75'),rounding=ROUND_CEILING)
    return {'method':'full state DP with conservative IEEE-754 error enclosure',
            'failure_lower':str(lo),'failure_upper':str(hi),'coverage_cap_upper':str(cap),
            'scalar_operations_bound':ops+ops2,'cap_below_93':cap<Decimal('.93')}

def wilson(k,n):
    p=k/n; z=1.959963984540054; z2=z*z
    c=(p+z2/(2*n))/(1+z2/n)
    h=z*math.sqrt(p*(1-p)/n+z2/(4*n*n))/(1+z2/n)
    return [c-h,c+h]

def simulation(ps,m,case_id):
    L,n=len(ps),len(ps)*m; mu=sum(ps,F(0))/L; truth=float(mu)
    seed=int.from_bytes(hashlib.sha256((SEED+'/'+case_id).encode()).digest()[:16],'little')
    rng=np.random.Generator(np.random.PCG64(seed))
    groups=[]
    for p in sorted(set(ps)):
        qs,den=q_integer(p,m)
        groups.append((ps.count(p),np.array([float(F(q,den)) for q in qs])))
    nf=1<<(n+1-1).bit_length()
    omega=np.exp(-2j*np.pi*np.arange(nf)/nf)
    logphi=np.array([np.log((1-k/m)+(k/m)*omega) for k in range(m+1)])
    cc=math.sqrt(m/(m-1)); lo_count=hi_count=0; sumlo=sumhi=0.
    boundary_mass=0; max_fft_negative=0.
    for start in range(0,N_SIM,BATCH):
        size=min(BATCH,N_SIM-start); hist=np.zeros((size,m+1),dtype=np.int64)
        for count,q in groups: hist+=rng.multinomial(count,q,size=size)
        s=hist@np.arange(m+1)
        cf=np.exp((hist*m)@logphi)
        pmf=np.fft.ifft(cf,axis=1).real[:,:n+1]
        max_fft_negative=min(max_fft_negative,float(pmf.min()))
        pmf=np.maximum(pmf,0); pmf/=pmf.sum(axis=1)[:,None]
        cdf=np.cumsum(pmf,axis=1)
        threshold=s+(n*truth-s)/cc
        r=np.floor(threshold+1e-12).astype(int)
        exact_equal=(s*mu.denominator==n*mu.numerator)
        rlt=r-exact_equal.astype(int)
        fle=cdf[np.arange(size),np.clip(r,0,n)]
        flt=cdf[np.arange(size),np.clip(rlt,0,n)]
        fle=np.where(r<0,0,np.where(r>=n,1,fle))
        flt=np.where(rlt<0,0,np.where(rlt>=n,1,flt))
        # For interpolation positions 249.975 and 9749.025, these are
        # sufficient and necessary binomial order-statistic conditions.
        inner=np.clip(bdtr(9749,B,flt)-bdtr(250,B,fle),0,1)
        outer=np.clip(bdtr(9750,B,flt)-bdtr(249,B,fle),0,1)
        zeros=s==0; ones=s==n; boundary_mass+=int((zeros|ones).sum())
        inner[zeros]=outer[zeros]=float(boundary_covers(mu,n,False))
        inner[ones]=outer[ones]=float(boundary_covers(mu,n,True))
        assert np.all(inner<=outer+1e-10)
        u=rng.random(size)
        lo_count+=int((u<inner).sum()); hi_count+=int((u<outer).sum())
        sumlo+=float(inner.sum()); sumhi+=float(outer.sum())
    return {'datasets':N_SIM,'bootstrap_draws_per_conceptual_dataset':B,
            'method':'targeted marginal finite-B coverage enclosure; FFT CDF plus necessary/sufficient order-statistic probabilities; fresh resampling, NOT the frozen matrix',
            'coverage_estimate_lower':lo_count/N_SIM,'coverage_estimate_upper':hi_count/N_SIM,
            'mc95_enclosure':[wilson(lo_count,N_SIM)[0],wilson(hi_count,N_SIM)[1]],
            'rao_blackwell_lower':sumlo/N_SIM,'rao_blackwell_upper':sumhi/N_SIM,
            'boundary_samples':boundary_mass,'fft_negative_roundoff_min':max_fft_negative,
            'seed_namespace':SEED+'/'+case_id}

def cases():
    out=[]
    for split,(lt,m) in ALLOC.items():
        specs={}
        def add(label,probs): specs.setdefault(tuple(probs),[]).append(label)
        for homogeneous in (True,False):
            qs=[F('.4')]*5 if homogeneous else P
            dist='homogeneous' if homogeneous else 'heterogeneous'
            for j,label in enumerate(TYPES):
                add(f'{dist}/within-{label}/C,O,R',[qs[j]]*lt)
                add(f'{dist}/within-{label}/J',[qs[j]**3]*lt)
            add(f'{dist}/overall/C,O,R',[p for p in qs for _ in range(lt)])
            add(f'{dist}/overall/J',[p**3 for p in qs for _ in range(lt)])
        for i,(ps,labels) in enumerate(specs.items()):
            out.append({'id':f'{split}-{i:02d}','split':split,'L':len(ps),'m':m,
                        'probabilities':ps,'labels':labels})
    return out

def independent_pilot_check():
    p=F(2,5); n=12; fail=F(0)
    for bits in product((0,1),repeat=n):
        ks=[sum(bits[j:j+2]) for j in range(0,n,2)]; s=sum(ks)
        misses=sign_positive(s*5-n*2,(2*sum(k==2 for k in ks)-s)*5,2)
        flipped=[2-k for k in ks]; sf=n-s
        misses|=sign_positive(sf*5-n*3,(2*sum(k==2 for k in flipped)-sf)*5,2)
        if s==0 and boundary_covers(p,n,False): misses=False
        if s==n and boundary_covers(p,n,True): misses=False
        if misses: fail+=p**s*(1-p)**(n-s)
    a,_=exact_lower_miss([p]*6,2); b,_=exact_lower_miss([1-p]*6,2)
    assert fail==a+b==F('0.1175200768')
    return {'ordered_datasets':4096,'failure_exact':str(fail),'coverage_cap':str(decimal_fraction(1-fail))}

def main():
    assert all(sign_positive(a,b,m)==(a+b*math.sqrt(m/(m-1))>0)
               for m in (2,4,8) for a in range(-20,21) for b in range(-20,21))
    pilot=independent_pilot_check(); print('Independent pilot enumeration PASS',pilot,flush=True)
    report={'purpose':'synthetic design check only; no pilot observations or research results',
            'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'python':platform.python_version(),'numpy':np.__version__,'scipy':scipy.__version__,
            'pilot_independent_check':pilot,'cases':[]}
    for case in cases():
        ps=case['probabilities']; row={k:v for k,v in case.items() if k!='probabilities'}
        row['probability_groups']=[{'p':str(p),'lineages':ps.count(p)} for p in sorted(set(ps))]
        row['truth']=str(sum(ps,F(0))/len(ps))
        row['structural']=structural(ps,case['m'])
        print(case['id'],'structural cap',row['structural']['coverage_cap_upper'],flush=True)
        row['targeted']=simulation(list(ps),case['m'],case['id'])
        report['cases'].append(row)
        report['elapsed_seconds']=time.monotonic()-START
        (ROOT/'a5-structural-r1-results.json').write_text(json.dumps(report,indent=2)+'\n')
        t=row['targeted']; print(case['id'],'targeted',t['coverage_estimate_lower'],t['coverage_estimate_upper'],t['mc95_enclosure'],'elapsed',round(report['elapsed_seconds'],1),flush=True)
    report['complete']=True
    report['cases_with_cap_below_93']=[r['id'] for r in report['cases'] if r['structural']['cap_below_93']]
    (ROOT/'a5-structural-r1-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print('COMPLETE cases',len(report['cases']),'cap<93',report['cases_with_cap_below_93'],flush=True)

if __name__=='__main__': main()
