#!/usr/bin/env python3
"""Require CI and security scans for the release commit before publishing."""
import json
import os
import time
import urllib.request

WORKFLOWS = ('.github/workflows/backend-ci.yml', '.github/workflows/security-scan.yml')


def check_runs(runs, sha):
    pending = []
    for path in WORKFLOWS:
        matching = [run for run in runs if run['head_sha'] == sha and run['path'] == path]
        if not matching:
            pending.append(path + ': not started')
            continue
        latest = max(matching, key=lambda run: run['id'])
        if latest['status'] != 'completed':
            pending.append(path + ': ' + latest['status'])
        elif latest['conclusion'] != 'success':
            raise RuntimeError(f"{path} failed: {latest['html_url']}")
    return pending


def main():
    repository = os.environ['GITHUB_REPOSITORY']
    sha = os.environ['RELEASE_SHA']
    url = f'https://api.github.com/repos/{repository}/actions/runs?head_sha={sha}&per_page=100'
    headers = {'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'],
               'Accept': 'application/vnd.github+json'}
    deadline = time.monotonic() + 45 * 60
    while time.monotonic() < deadline:
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            runs = json.load(response)['workflow_runs']
        pending = check_runs(runs, sha)
        if not pending:
            print('CI and security scans passed for ' + sha, flush=True)
            return
        print('Waiting for release checks: ' + ', '.join(pending), flush=True)
        time.sleep(30)
    raise RuntimeError('Timed out waiting for release checks')


if __name__ == '__main__':
    main()
