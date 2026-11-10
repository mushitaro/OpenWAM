"""Evaluate saved captures without a solver: python scripts/assess_capture.py LOG... --output RESULT."""
from pathlib import Path
import sys, json, hashlib, argparse
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.fitting_evidence import assess_record


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('logs',nargs='+',type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    results=[]
    for path in args.logs:
        raw=path.read_bytes()
        result=assess_record(json.loads(raw))
        result.update(source=str(path.resolve()),sha256=hashlib.sha256(raw).hexdigest())
        results.append(result)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps({'evaluations':results,'solver_runs':0},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps([{'file':r['source'],'rows':r['rows'],'visits':len(r['visits']),'status':r['status']} for r in results],ensure_ascii=False))

if __name__=='__main__': main()
