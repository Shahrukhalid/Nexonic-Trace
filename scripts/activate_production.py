"""Enable production publishing only after a complete verified candidate run.

Run locally as the repository owner. This never creates tags or publishes files.
"""
import argparse
import json
import shutil
from pathlib import Path
import tempfile
from production import REPO, ROOT, run, validate_inventory


def activate(run_id, enable=False):
    current=run(['git','rev-parse','HEAD'],capture=True).strip()
    run(['git','fetch','origin','main'])
    if current!=run(['git','rev-parse','origin/main'],capture=True).strip():
        raise ValueError('Check out the latest protected main before activation')
    owner=run(['gh','api','user','--jq','.login'],capture=True).strip()
    if owner!=REPO.split('/')[0]: raise ValueError('Production activation requires the repository owner')
    result=json.loads(run(['gh','api',f'repos/{REPO}/actions/runs/{run_id}'],capture=True))
    if (result.get('path')!='.github/workflows/production.yml' or result.get('head_sha')!=current
            or result.get('head_branch')!='main' or result.get('event')!='workflow_dispatch'
            or result.get('conclusion')!='success'):
        raise ValueError('A successful production candidate run from current main is required')
    jobs=json.loads(run(['gh','api',f'repos/{REPO}/actions/runs/{run_id}/jobs?per_page=100'],capture=True))['jobs']
    expected={'Production source policy','Signed Windows candidate','Signed macOS candidate (macos-15)',
              'Signed macOS candidate (macos-15-intel)','Signed Android candidate'}
    if {j['name'] for j in jobs if j['conclusion']=='success'}!=expected:
        raise ValueError('All signed platform candidates must pass together before activation')
    artifacts=json.loads(run(['gh','api',f'repos/{REPO}/actions/runs/{run_id}/artifacts?per_page=100'],capture=True))['artifacts']
    names={'production-windows','production-aarch64-apple-darwin','production-x86_64-apple-darwin','production-android'}
    selected=[a for a in artifacts if a['name'] in names and not a['expired']]
    if len(selected)!=4 or {a['name'] for a in selected}!=names: raise ValueError('Complete candidate artifacts are required')
    with tempfile.TemporaryDirectory(prefix='NexonicProductionActivation-') as temporary:
        root=Path(temporary); merged=root/'merged';merged.mkdir()
        for artifact in selected:
            destination=root/artifact['name']
            run(['gh','run','download',str(run_id),'--repo',REPO,'--name',artifact['name'],'--dir',destination])
            for file in destination.iterdir():
                if not file.is_file() or (merged/file.name).exists(): raise ValueError('Unexpected candidate contents')
                shutil.copyfile(file,merged/file.name)
        validate_inventory(merged,current)
    if enable:
        run(['gh','variable','set','PRODUCTION_RELEASES_ENABLED','--repo',REPO,'--env','production-signing','--body','true'])
        print('Production publication activated after complete signed acceptance.')
    else:
        print('Complete candidate verified. Use --enable to activate; no settings were changed.')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('run_id',type=int)
    parser.add_argument('--enable',action='store_true')
    args=parser.parse_args()
    try: activate(args.run_id,args.enable)
    except (ValueError,OSError,KeyError) as error: raise SystemExit(str(error))
