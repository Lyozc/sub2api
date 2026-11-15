import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('wait_release_checks', Path(__file__).with_name('wait_release_checks.py'))
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


class ReleaseChecksTest(unittest.TestCase):
    def run_result(self, path, run_id=1, sha='release', status='completed', conclusion='success'):
        return dict(path=path, id=run_id, head_sha=sha, status=status, conclusion=conclusion, html_url='https://example.com/run')

    def test_both_workflows_must_succeed_on_release_commit(self):
        runs = [self.run_result(path) for path in checks.WORKFLOWS]
        self.assertEqual(checks.check_runs(runs, 'release'), [])
        self.assertEqual(len(checks.check_runs(runs, 'other-commit')), 2)

    def test_missing_and_running_scans_keep_publication_waiting(self):
        runs = [self.run_result(checks.WORKFLOWS[0], status='in_progress', conclusion=None)]
        self.assertEqual(len(checks.check_runs(runs, 'release')), 2)

    def test_newest_scan_failure_blocks_publication(self):
        runs = [self.run_result(path) for path in checks.WORKFLOWS]
        runs.append(self.run_result(checks.WORKFLOWS[1], run_id=2, conclusion='failure'))
        with self.assertRaisesRegex(RuntimeError, 'failed'):
            checks.check_runs(runs, 'release')


if __name__ == '__main__':
    unittest.main()
