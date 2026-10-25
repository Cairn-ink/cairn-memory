#!/usr/bin/env python3
"""Rigorous finite-10,000 percentile coverage upper bounds on synthetic cells.

Enumerates exact source histogram weights and exact conditional bootstrap CDFs.
Outward-rounded interval-arithmetic Chernoff bounds upper-bound the probability
that the necessary order-statistic condition for coverage occurs. Unenumerated
source states are assigned coverage ONE, never dropped. This concerns fresh
independent bootstrap draws, not the one frozen protocol draw matrix.
"""
import sys, math, json, hashlib, time
from decimal import Decimal, localcontext, ROUND_FLOOR, ROUND_CEILING
from fractions import Fraction as F
from pathlib import Path
import mpmath as mp
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
import importlib.util
spec=importlib.util.spec_from_file_location('structural',ROOT/'a5-structural-r1.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
mp.iv.dps=60
B=10000

def fraction_endpoint(x):
    sign,mant,exp,_=map(int,x._mpi_[1])
    assert not sign
    return F(mant*(2**exp),1) if exp>=0 else F(mant,2**(-exp))

def chernoff_upper(p,t):
    # p,t are exact probabilities; the appropriate one-sided event is rare.
    if p in (0,1): return F(0)
    k=int(t*B); assert F(k,B)==t
    ip=mp.iv.mpf(p.numerator)/p.denominator
    it=mp.iv.mpf(t.numerator)/t.denominator
    bound=(ip/it)**k*((1-ip)/(1-it))**(B-k)
    return min(F(1),fraction_endpoint(bound))

def conditional_outer(a,m,mu):
    L=sum(a);n=L*m;s=sum(k*x for k,x in enumerate(a))
    if s in (0,n): return F(int(base.boundary_covers(mu,n,s==n)))
    lower_a=s*mu.denominator-n*mu.numerator
    lower_b=(m*a[m]-s)*mu.denominator
    upper_b=(m*(L-a[0])-s)*mu.denominator
    if base.sign_positive(lower_a,lower_b,m) or base.sign_positive(-lower_a,-upper_b,m): return F(0)
    coeff=[1]; den=1
    for k in range(1,m):
        for _ in range(m*a[k]):
            out=[0]*(len(coeff)+1)
            for j,v in enumerate(coeff): out[j]+=(m-k)*v;out[j+1]+=k*v
            coeff=out;den*=m
    le=lt=0;shift=m*a[m]
    for j,v in enumerate(coeff):
        b=(shift+j-s)*mu.denominator
        if not base.sign_positive(lower_a,b,m): le+=v
        if base.sign_positive(-lower_a,-b,m): lt+=v
    ple,plt=F(le,den),F(lt,den)
    bound=F(1)
    # Necessary: at least 250 draws <= truth and at most 9750 draws < truth.
    if ple<F(1,40): bound=min(bound,chernoff_upper(ple,F(1,40)))
    if plt>F(39,40): bound=min(bound,chernoff_upper(plt,F(39,40)))
    return bound

def profiles(L,m,max_success=None,max_cell=None):
    if max_success is None:
        def rec(k,left,prefix):
            if k==m: yield tuple(prefix+[left]);return
            for v in range(left+1): yield from rec(k+1,left-v,prefix+[v])
        yield from rec(0,L,[]);return
    # Exact partition enumeration by total successes; no duplicates.
    max_cell=m if max_cell is None else max_cell
    def parts(k,s,left,a):
        if k>max_cell:
            if s==0: yield tuple([left]+a+[0]*(m-max_cell))
            return
        for count in range(min(left,s//k)+1):
            yield from parts(k+1,s-k*count,left-count,a+[count])
    for s in range(max_success+1): yield from parts(1,s,L,[])

def source_weight(a,m,p):
    L=sum(a);n=m*L;s=sum(k*x for k,x in enumerate(a))
    c=math.factorial(L)
    c//=math.prod(math.factorial(x) for x in a)
    c*=math.prod(math.comb(m,k)**x for k,x in enumerate(a))
    return F(c*p.numerator**s*(p.denominator-p.numerator)**(n-s),p.denominator**n)

def proof(L,m,p,max_success=None,max_cell=None):
    total=F(0); failure_lower=Decimal(0); count=0
    for a in profiles(L,m,max_success,max_cell):
        w=source_weight(a,m,p);total+=w;count+=1
        outer=conditional_outer(a,m,p)
        with localcontext() as ctx:
            ctx.prec=90;ctx.rounding=ROUND_FLOOR
            term=Decimal((w*(1-outer)).numerator)/Decimal((w*(1-outer)).denominator)
            failure_lower+=term
    assert total<=1
    if max_success is None: assert total==1
    with localcontext() as ctx:
        ctx.prec=90;ctx.rounding=ROUND_CEILING
        cap=Decimal(1)-failure_lower
    return {'L':L,'m':m,'p':str(p),'profiles':count,'enumeration_complete':max_success is None,
            'enumerated_source_mass':str(base.decimal_fraction(total)),
            'unexamined_coverage_assumption':1,'guaranteed_failure_lower':str(failure_lower),
            'finite_B_coverage_upper':str(cap),'upper_below_93':cap<Decimal('.93')}

def main():
    start=time.monotonic();rows=[]
    # Complete 1001 source profiles for every distinct development within-type p.
    ps=sorted(set(base.P+[p**3 for p in base.P]))
    tasks=[('development-within',10,4,p,None,None) for p in ps]
    # Sparse overall J and sparse test J: enough exact source profiles to prove
    # failure if possible; remaining source probability conservatively covers.
    tasks += [('development-overall-homogeneous-J',50,4,F('.064'),40,None),
              ('test-within-reversal-J',40,8,F('.027'),32,2)]
    for label,L,m,p,smax,kmax in tasks:
        r={'id':label,'method':'exact histogram/source and conditional-CDF enumeration + outward interval Chernoff finite-B upper bound',**proof(L,m,p,smax,kmax)}
        rows.append(r);print(label,p,r['profiles'],r['finite_B_coverage_upper'],'<93',r['upper_below_93'],'elapsed',round(time.monotonic()-start,1),flush=True)
        report={'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'bootstrap_draws':B,'arithmetic':'exact integer/Fraction CDF and source weights; 60-digit outward-rounded mpmath.iv Chernoff; 90-digit downward failure sum','rows':rows,'elapsed_seconds':time.monotonic()-start}
        (ROOT/'a5-percentile-bound-r1-results.json').write_text(json.dumps(report,indent=2)+'\n')
    report['complete']=True
    (ROOT/'a5-percentile-bound-r1-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print('COMPLETE',flush=True)

if __name__=='__main__':main()
