from fastapi.testclient import TestClient
from app.main import app
from app.core import synthetic

def test_timeline_freeze_and_rollback():
    c=TestClient(app);rows=synthetic(260)
    p=dict(rows=rows,start=0,end=180,actions=[dict(at=180,frozen=False,approved=True),dict(at=200,frozen=True),dict(at=210,rollback=True)])
    result=c.post('/api/run',json=p).json()['scores']
    assert any(s['updated'] for s in result[180:200])
    assert all(not s['updated'] for s in result[200:])
    assert result[210]['version']==result[209]['version']+1
