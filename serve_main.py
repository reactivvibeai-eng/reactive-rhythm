#!/usr/bin/env python3
"""Preview-launcher entry: chdir to this file's folder, then run the dev server
(serve.py) so the preview harness can start it from any cwd. Test build only."""
import os
import runpy

os.chdir(os.path.dirname(os.path.abspath(__file__)))
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "serve.py"), run_name="__main__")
