import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.core import Monitor, synthetic, validate
from app.main import app

def test_freeze_rollback_and_score_before_update():
    x=synthetic();m=Monitor(x);m.frozen=False
    row=m.base+m.scale*.5
    before=m.center.copy();s=m.score(row,True)
    assert s['adaptive']==pytest.approx(.5)
    assert s['updated'] and np.any(m.center!=before)
    m.rollback();assert np.allclose(m.center,before) and m.frozen
    m.score(row,True);assert np.array_equal(m.center,before)

def test_no_labels_or_unapproved_updates():
    m=Monitor(synthetic());m.frozen=False;b=m.center.copy()
    m.score(m.base+m.scale,False);assert np.array_equal(b,m.center)
    m.score(m.base+20*m.scale,True);assert np.array_equal(b,m.center)
    m.score([None,230,8],True);assert np.array_equal(b,m.center)
    with pytest.raises(TypeError):m.score(m.base,label=True)

def test_causal_future_and_immutable_baseline():
    x=synthetic();a=Monitor(x);y=synthetic();y[900]=[99,999,999];b=Monitor(y)
    for row in x[180:190]:assert a.score(row)==b.score(row)
    baseline=a.base.copy();a.frozen=False
    for i in range(20):a.score(a.base+a.scale*.2,True)
    assert np.array_equal(a.base,baseline)

def test_validation_and_temporal_reference():
    with pytest.raises(ValueError):validate([[1,2]])
    with pytest.raises(ValueError):Monitor(synthetic(),0,10)
    x=synthetic();x[2][0]=None
    with pytest.raises(ValueError):Monitor(x)

def test_api_repeatability_reset_and_source():
    c=TestClient(app);d=c.get('/api/data').json(); payload=dict(rows=d['rows'][:240],start=0,end=180)
    a=c.post('/api/run',json=payload);assert a.status_code==200
    assert a.json()==c.post('/api/run',json=payload).json()
    payload['rows'][190][0]+=10
    b=c.post('/api/run',json=payload).json();assert b['scores'][190]['fixed']>4
    assert a.json()['scores'][190]['fixed']<4
    assert c.post('/api/run',json=dict(rows=[[1,2]])).status_code==422
    assert c.get('/').status_code==200
