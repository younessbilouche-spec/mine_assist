import os

file_path = 'backend/models/train_rf_grav3.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Remplacements pour éviter UnicodeEncodeError dans le terminal Windows
replacements = {
    '\u2265': '>=',
    '\u2192': '->',
    '\u2500': '-',
    '\u2713': '[OK]',
    '\u274c': '[X]',
    '\u2139': '[i]',
    '\u26a0': '[!]',
    '\u00b7': '|',
    '\u2026': '...',
}

for old, new in replacements.items():
    content = content.replace(old, new)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Script train_rf_grav3.py nettoyé des caractères spéciaux.")
