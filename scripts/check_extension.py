#!/usr/bin/env python3
"""Check packaged extension paths and JavaScript without starting the servers."""

import argparse
import fnmatch
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import subprocess
from urllib.parse import unquote, urlsplit

CHECKED_SCRIPTS = set()


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in {'src', 'href', 'poster'} and value:
                self.references.append(value)


def validate_files(files, check_syntax=True):
    errors = []
    checked_references = 0
    extension = {name.removeprefix('extension/'): data for name, data in files.items()
                 if name.startswith('extension/')}
    if 'manifest.json' not in extension:
        return ['extension/manifest.json is missing'], 0

    def require(source, url, root_relative=False, pattern=False):
        nonlocal checked_references
        if not url or url.startswith(('#', '//')):
            return
        parsed = urlsplit(url)
        if parsed.scheme == 'chrome-extension':
            path = unquote(parsed.path).lstrip('/')
        elif parsed.scheme:
            return
        else:
            path = unquote(parsed.path)
            if root_relative or path.startswith('/'):
                path = path.lstrip('/')
            else:
                path = posixpath.join(posixpath.dirname(source), path)
        path = posixpath.normpath(path)
        checked_references += 1
        if path.startswith('../') or path == '..':
            errors.append(f'{source}: resource escapes extension directory: {url}')
        elif pattern:
            if not any(fnmatch.fnmatchcase(name, path) for name in extension):
                errors.append(f'{source}: resource pattern matches no files: {url}')
        elif path not in extension:
            errors.append(f'{source}: missing resource: {url} (resolved to {path})')

    try:
        manifest = json.loads(extension['manifest.json'])
    except (ValueError, UnicodeError) as exc:
        return [f'invalid extension manifest: {exc}'], 0
    background = manifest.get('background', {})
    require('manifest.json', background.get('service_worker', ''), True)
    action = manifest.get('action', {})
    require('manifest.json', action.get('default_popup', ''), True)
    for icons in (manifest.get('icons', {}), action.get('default_icon', {})):
        for value in ([icons] if isinstance(icons, str) else icons.values()):
            require('manifest.json', value, True)
    for entry in manifest.get('content_scripts', []):
        for value in entry.get('css', []) + entry.get('js', []):
            require('manifest.json', value, True)
    for entry in manifest.get('web_accessible_resources', []):
        for value in entry.get('resources', []):
            require('manifest.json', value, True, pattern=True)
    if sum('suggested_key' in value for value in manifest.get('commands', {}).values()) > 4:
        errors.append('manifest.json: more than four suggested keyboard shortcuts')

    node = shutil.which('node')
    if check_syntax and not node:
        errors.append('Node.js is required for JavaScript syntax checks')
    for path, data in extension.items():
        suffix = PurePosixPath(path).suffix
        if suffix not in {'.html', '.css', '.js'}:
            continue
        source = data.decode('utf-8')
        if suffix == '.html':
            page = PageReferences()
            page.feed(source)
            for value in page.references:
                require(path, value)
        if suffix in {'.html', '.css'}:
            for value in re.findall(r'url\(\s*[\"\']?([^\"\')]+)[\"\']?\s*\)', source):
                require(path, value.strip())
        if suffix != '.js':
            continue
        for value in re.findall(r'(?:chrome\.runtime\.getURL|preloadImageAsset)\(\s*[\"\']([^\"\']+)[\"\']', source):
            require(path, value, True)
        for value in re.findall(r'(?:import\(\s*|from\s+)[\"\']([^\"\']+)[\"\']', source):
            if value.startswith('.'):
                require(path, value)
        for value in re.findall(r'url:\s*[\"\']([^\"\']+\.html)[\"\']', source):
            require(path, value, True)
        for value in re.findall(r'[\"\'](styles/fonts/[^\"\']+\.css)[\"\']', source):
            require(path, value, True)
        if PurePosixPath(path).name in {'content.js', 'popup.js'}:
            for value in re.findall(r'[\"\']((?:arrow|pencil|black)-large(?:-white)?\.(?:png|cur))[\"\']', source):
                require(path, 'assets/cursors/' + value, True)
        digest = hashlib.sha256(data).hexdigest()
        if check_syntax and node and digest not in CHECKED_SCRIPTS:
            script_type = 'module' if re.search(r'^(?:import|export)\s', source, re.M) else 'commonjs'
            result = subprocess.run([node, '--check', '--input-type=' + script_type],
                                    input=data, capture_output=True)
            if result.returncode:
                errors.append(f'{path}: {result.stderr.decode().strip()}')
            else:
                CHECKED_SCRIPTS.add(digest)
    return errors, checked_references


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    files = {p.relative_to(args.root).as_posix(): p.read_bytes()
             for p in (args.root / 'extension').rglob('*') if p.is_file()}
    errors, count = validate_files(files)
    if errors:
        for error in errors:
            print(error)
        raise SystemExit(1)
    print(f'Extension checks passed: {count} resource references and {len(CHECKED_SCRIPTS)} JavaScript files.')


if __name__ == '__main__':
    main()
