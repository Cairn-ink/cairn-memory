# Child-only byte copies. This process never imports SQLite.
import os, sys, shutil
mode, backup, *roots = sys.argv[1:]

def restore(src, dst):
    for name in os.listdir(dst):
        if not os.path.lexists(os.path.join(src, name)):
            path = os.path.join(dst, name)
            if os.path.isdir(path) and not os.path.islink(path): shutil.rmtree(path)
            else: os.unlink(path)
    for name in os.listdir(src):
        a, b = os.path.join(src, name), os.path.join(dst, name)
        if os.path.islink(a):
            if os.path.lexists(b): os.unlink(b)
            os.symlink(os.readlink(a), b)
        elif os.path.isdir(a):
            os.makedirs(b, exist_ok=True)
            restore(a, b)
        else:
            shutil.copyfile(a, b)
            shutil.copystat(a, b)

for i, root in enumerate(roots):
    saved = os.path.join(backup, str(i))
    if mode == 'save': shutil.copytree(root, saved, symlinks=True)
    else: restore(saved, root)
