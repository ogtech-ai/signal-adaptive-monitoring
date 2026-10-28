"""Create a source-only migration archive; no venv, cache, video, secrets or Git internals."""
import hashlib,json,subprocess,tarfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
tracked=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
exact={'Dockerfile','.dockerignore','compose.yaml','compose.linux-amd64.yaml','requirements.lock','requirements.txt','requirements-dev.txt','LICENSE','README.md','data/uci_slice.json','data/ATTRIBUTION.md','docs/MIGRATION.md','docs/benchmark.json','docs/linux-amd64-dependencies.json'}
files=sorted(f for f in tracked if f and (f in exact or f.startswith(('app/','tests/')) or f in {'scripts/download_uci.py','scripts/benchmark.py','scripts/package_migration.py'}))
assert {'app/main.py','app/core.py','data/uci_slice.json','Dockerfile','compose.linux-amd64.yaml'}<=set(files)
for f in files:
    p=root/f
    assert p.is_file() and not p.is_symlink() and p.stat().st_size<2_000_000,f
    assert not any(x in p.relative_to(root).parts for x in ('.git','.venv','cache','node_modules')),f
out=root/'delivery'/f'signal-adaptive-monitoring-linux-amd64-{commit[:7]}.tar.gz'
out.parent.mkdir(exist_ok=True)
with tarfile.open(out,'w:gz') as tar:
    for f in files:tar.add(root/f,arcname='signal-adaptive-monitoring/'+f,recursive=False)
receipt={'archive':str(out),'commit':commit,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'files':files,'scope':'source-only; amd64 wheels verified separately; container build/run not executed on Mac'}
Path(str(out)+'.manifest.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt,indent=2))
