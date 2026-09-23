#!/usr/bin/env python3
import sys, json
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

transcript_path = 'C:/Users/USER/.claude/projects/C--Users-USER-Desktop-LESAVI-SURAMADU-LESAVI-SURAMADU/0afb3f28-4bb7-4388-af1f-0e54f315ef3f.jsonl'
with open(transcript_path, encoding='utf-8', errors='replace') as f:
    raw = f.read()

# Parse as JSONL
lines = raw.split('\
')
print(f'Total lines: {len(lines)}')

# Find entries with wireToolInputs for AmProfilePage.tsx
for i, line in enumerate(lines):
    if 'AmProfilePage' in line and 'wireToolInputs' in line:
        try:
            entry = json.loads(line)
            wti = entry.get('wireToolInputs', {})
            for tool_id, inp in wti.items():
                fp = inp.get('file_path', '')
                if 'AmProfilePage' in fp:
                    content = inp.get('content', '')
                    if content and len(content) > 5000:
                        print(f'Line {i}: tool_id={tool_id}, content_len={len(content)}')
                        # Check for embedded/standalone
                        if 'if (embedded)' in content and 'const TABS' in content:
                            print(f'  *** FOUND FULL FILE ***')
                            # Unescape the content
                            unescaped = content.replace('\\
', '\
').replace('\\	', '\	').replace('\\"', '"').replace('\\\\', '\\')
                            with open('C:/Users/USER/Desktop/LESAVI-SURAMADU/LESAVI-SURAMADU/_amprofile_restore.tsx', 'w', encoding='utf-8') as f2:
                                f2.write(unescaped)
                            print(f'  Saved! Lines: {unescaped.count(chr(10))}')
                            break
        except Exception as e:
            pass
