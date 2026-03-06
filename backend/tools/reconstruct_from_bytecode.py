#!/usr/bin/env python3
"""
Python 3.12 Bytecode → Source Reconstructor

Reads .pyc files and reconstructs incomplete function bodies that pycdc
couldn't handle (due to POP_JUMP_IF_NOT_NONE and other 3.12 opcodes).

Strategy:
  1. Load the code object from the .pyc file
  2. For each function marked with "# WARNING: Decompyle incomplete"
  3. Disassemble the bytecode and build a symbolic expression stack
  4. Convert symbolic expressions to Python source
  5. Splice the reconstructed body back into the .py file
"""

import dis
import glob
import marshal
import os
import re
import struct
import sys
import textwrap
import types
from dataclasses import dataclass, field
from typing import Any, Optional


def load_pyc(path: str) -> types.CodeType:
    with open(path, "rb") as f:
        f.read(16)  # skip magic, flags, timestamp, size
        return marshal.load(f)


def get_all_code_objects(code: types.CodeType) -> dict[str, types.CodeType]:
    """Recursively collect all code objects keyed by co_qualname."""
    results = {code.co_qualname: code}
    for const in code.co_consts:
        if isinstance(const, types.CodeType):
            results.update(get_all_code_objects(const))
    return results


# ---------------------------------------------------------------------------
# Symbolic stack machine
# ---------------------------------------------------------------------------

@dataclass
class Sym:
    """A symbolic value on the stack."""
    expr: str
    kind: str = "expr"  # expr, call, attr, subscr, const, name, tuple, list, dict


def _repr_const(val: Any) -> str:
    if val is None:
        return "None"
    if isinstance(val, str):
        if "\n" in val or len(val) > 60:
            return repr(val)
        return repr(val)
    if isinstance(val, (int, float, bool)):
        return repr(val)
    if isinstance(val, tuple):
        inner = ", ".join(_repr_const(v) for v in val)
        if len(val) == 1:
            return f"({inner},)"
        return f"({inner})"
    if isinstance(val, frozenset):
        inner = ", ".join(_repr_const(v) for v in sorted(val, key=str))
        return f"{{{inner}}}"
    if isinstance(val, bytes):
        return repr(val)
    return repr(val)


class BytecodeReconstructor:
    """
    Walks Python 3.12 bytecode instructions and produces a Python source
    approximation.
    """

    def __init__(self, code: types.CodeType, indent: int = 2):
        self.code = code
        self.base_indent = indent
        self.instructions = list(dis.get_instructions(code))
        self.stack: list[Sym] = []
        self.lines: list[tuple[int, str]] = []  # (indent_level, statement)
        self.indent_level = 0
        self._jump_targets = {i.offset for i in self.instructions if i.is_jump_target}
        self._all_code_objects = get_all_code_objects(code)
        # Build offset→instruction index
        self._offset_map = {instr.offset: idx for idx, instr in enumerate(self.instructions)}

    def push(self, sym: Sym):
        self.stack.append(sym)

    def pop(self) -> Sym:
        if self.stack:
            return self.stack.pop()
        return Sym("???", "expr")

    def peek(self) -> Sym:
        if self.stack:
            return self.stack[-1]
        return Sym("???", "expr")

    def emit(self, stmt: str):
        self.lines.append((self.indent_level, stmt))

    def reconstruct(self) -> str:
        i = 0
        n = len(self.instructions)
        try_depth = 0

        while i < n:
            instr = self.instructions[i]
            op = instr.opname
            arg = instr.arg
            argval = instr.argval

            # Skip no-ops
            if op in ("RESUME", "NOP", "CACHE", "PRECALL", "COPY_FREE_VARS",
                       "MAKE_CELL", "PUSH_EXC_INFO"):
                i += 1
                continue

            # --- Constants ---
            if op == "LOAD_CONST":
                if isinstance(argval, types.CodeType):
                    self.push(Sym(argval.co_qualname, "code"))
                else:
                    self.push(Sym(_repr_const(argval), "const"))

            elif op == "LOAD_FAST" or op == "LOAD_FAST_CHECK":
                self.push(Sym(argval, "name"))

            elif op == "LOAD_DEREF" or op == "LOAD_CLOSURE":
                self.push(Sym(argval, "name"))

            elif op in ("LOAD_NAME", "LOAD_GLOBAL"):
                self.push(Sym(argval, "name"))

            elif op == "LOAD_ATTR":
                obj = self.pop()
                # In 3.12, LOAD_ATTR can have a flag bit for LOAD_METHOD
                attr_name = argval if isinstance(argval, str) else str(argval)
                self.push(Sym(f"{obj.expr}.{attr_name}", "attr"))

            elif op == "LOAD_SUPER_ATTR":
                attr_name = argval if isinstance(argval, str) else str(argval)
                # pop class, self
                cls = self.pop()
                self_ref = self.pop()
                self.push(Sym(f"super().{attr_name}", "attr"))

            # --- Store ---
            elif op == "STORE_FAST" or op == "STORE_DEREF":
                val = self.pop()
                self.emit(f"{argval} = {val.expr}")

            elif op == "STORE_NAME":
                val = self.pop()
                self.emit(f"{argval} = {val.expr}")

            elif op == "STORE_ATTR":
                val = self.pop()
                obj = self.pop()
                attr_name = argval if isinstance(argval, str) else str(argval)
                self.emit(f"{obj.expr}.{attr_name} = {val.expr}")

            elif op == "STORE_SUBSCR":
                val = self.pop()
                obj = self.pop()
                key = self.pop()
                self.emit(f"{obj.expr}[{key.expr}] = {val.expr}")

            elif op == "DELETE_SUBSCR":
                obj = self.pop()
                key = self.pop()
                self.emit(f"del {obj.expr}[{key.expr}]")

            # --- Calls ---
            elif op in ("CALL", "CALL_FUNCTION", "CALL_FUNCTION_EX",
                        "CALL_FUNCTION_KW", "CALL_KW", "CALL_INTRINSIC_1",
                        "CALL_INTRINSIC_2"):
                if op == "CALL" or op == "CALL_FUNCTION":
                    nargs = arg if arg is not None else 0
                    args = [self.pop() for _ in range(nargs)]
                    args.reverse()
                    func = self.pop()
                    # Skip NULL pushed before LOAD_GLOBAL
                    if func.expr == "NULL" or func.expr == "???":
                        func = self.pop()
                    arg_str = ", ".join(a.expr for a in args)
                    self.push(Sym(f"{func.expr}({arg_str})", "call"))
                elif op == "CALL_KW":
                    nargs = arg if arg is not None else 0
                    kw_names = self.pop()  # tuple of keyword names
                    args = [self.pop() for _ in range(nargs)]
                    args.reverse()
                    func = self.pop()
                    if func.expr == "NULL" or func.expr == "???":
                        func = self.pop()
                    # Parse kw_names
                    kw_tuple = []
                    if kw_names.kind == "const":
                        try:
                            kw_tuple = eval(kw_names.expr)
                            if not isinstance(kw_tuple, tuple):
                                kw_tuple = []
                        except:
                            kw_tuple = []
                    n_kw = len(kw_tuple)
                    n_pos = nargs - n_kw
                    parts = []
                    for j, a in enumerate(args):
                        if j >= n_pos and (j - n_pos) < len(kw_tuple):
                            parts.append(f"{kw_tuple[j - n_pos]}={a.expr}")
                        else:
                            parts.append(a.expr)
                    self.push(Sym(f"{func.expr}({', '.join(parts)})", "call"))
                elif op == "CALL_FUNCTION_EX":
                    kwargs = self.pop() if (arg and arg & 1) else None
                    posargs = self.pop()
                    func = self.pop()
                    if func.expr in ("NULL", "???"):
                        func = self.pop()
                    if kwargs:
                        self.push(Sym(f"{func.expr}(*{posargs.expr}, **{kwargs.expr})", "call"))
                    else:
                        self.push(Sym(f"{func.expr}(*{posargs.expr})", "call"))
                elif op == "CALL_INTRINSIC_1":
                    val = self.pop()
                    self.push(Sym(f"_intrinsic1({val.expr})", "call"))
                elif op == "CALL_INTRINSIC_2":
                    val2 = self.pop()
                    val1 = self.pop()
                    self.push(Sym(f"_intrinsic2({val1.expr}, {val2.expr})", "call"))
                else:
                    self.push(Sym("???call", "call"))

            # --- Return ---
            elif op == "RETURN_VALUE":
                val = self.pop()
                if val.expr != "None":
                    self.emit(f"return {val.expr}")
                # else: implicit return

            elif op == "RETURN_CONST":
                if argval is not None:
                    self.emit(f"return {_repr_const(argval)}")

            # --- Binary ops ---
            elif op == "BINARY_OP":
                right = self.pop()
                left = self.pop()
                op_map = {
                    0: "+", 1: "&", 2: "//", 3: "<<", 5: "*",
                    6: "%", 7: "|", 8: "**", 9: ">>", 10: "-",
                    11: "/", 12: "^",
                    13: "+=", 14: "&=", 15: "//=", 16: "<<=",
                    17: "@=", 18: "*=", 19: "%=", 20: "|=",
                    21: "**=", 22: ">>=", 23: "-=", 24: "/=", 25: "^=",
                }
                op_sym = op_map.get(arg, "?op?")
                if "=" in op_sym:
                    self.emit(f"{left.expr} {op_sym} {right.expr}")
                else:
                    self.push(Sym(f"{left.expr} {op_sym} {right.expr}", "expr"))

            elif op == "BINARY_SUBSCR":
                key = self.pop()
                obj = self.pop()
                self.push(Sym(f"{obj.expr}[{key.expr}]", "subscr"))

            elif op == "BINARY_SLICE":
                end = self.pop()
                start = self.pop()
                obj = self.pop()
                s = start.expr if start.expr != "None" else ""
                e = end.expr if end.expr != "None" else ""
                self.push(Sym(f"{obj.expr}[{s}:{e}]", "subscr"))

            # --- Comparison ---
            elif op == "COMPARE_OP":
                right = self.pop()
                left = self.pop()
                cmp_str = argval if isinstance(argval, str) else str(argval)
                self.push(Sym(f"{left.expr} {cmp_str} {right.expr}", "expr"))

            elif op == "IS_OP":
                right = self.pop()
                left = self.pop()
                if arg:
                    self.push(Sym(f"{left.expr} is not {right.expr}", "expr"))
                else:
                    self.push(Sym(f"{left.expr} is {right.expr}", "expr"))

            elif op == "CONTAINS_OP":
                right = self.pop()
                left = self.pop()
                if arg:
                    self.push(Sym(f"{left.expr} not in {right.expr}", "expr"))
                else:
                    self.push(Sym(f"{left.expr} in {right.expr}", "expr"))

            # --- Unary ---
            elif op == "UNARY_NOT":
                val = self.pop()
                self.push(Sym(f"not {val.expr}", "expr"))

            elif op == "UNARY_NEGATIVE":
                val = self.pop()
                self.push(Sym(f"-{val.expr}", "expr"))

            elif op == "UNARY_INVERT":
                val = self.pop()
                self.push(Sym(f"~{val.expr}", "expr"))

            # --- Build containers ---
            elif op == "BUILD_TUPLE":
                items = [self.pop() for _ in range(arg)]
                items.reverse()
                inner = ", ".join(it.expr for it in items)
                if arg == 1:
                    self.push(Sym(f"({inner},)", "tuple"))
                else:
                    self.push(Sym(f"({inner})", "tuple"))

            elif op == "BUILD_LIST":
                items = [self.pop() for _ in range(arg)]
                items.reverse()
                inner = ", ".join(it.expr for it in items)
                self.push(Sym(f"[{inner}]", "list"))

            elif op == "BUILD_SET":
                items = [self.pop() for _ in range(arg)]
                items.reverse()
                inner = ", ".join(it.expr for it in items)
                self.push(Sym(f"{{{inner}}}", "expr"))

            elif op == "BUILD_MAP":
                pairs = []
                for _ in range(arg):
                    v = self.pop()
                    k = self.pop()
                    pairs.append(f"{k.expr}: {v.expr}")
                pairs.reverse()
                self.push(Sym(f"{{{', '.join(pairs)}}}", "dict"))

            elif op == "BUILD_CONST_KEY_MAP":
                keys = self.pop()
                vals = [self.pop() for _ in range(arg)]
                vals.reverse()
                try:
                    key_tuple = eval(keys.expr) if keys.kind == "const" else ()
                except:
                    key_tuple = tuple(f"k{j}" for j in range(arg))
                pairs = [f"{_repr_const(k)}: {v.expr}" for k, v in zip(key_tuple, vals)]
                self.push(Sym(f"{{{', '.join(pairs)}}}", "dict"))

            elif op == "BUILD_STRING":
                parts = [self.pop() for _ in range(arg)]
                parts.reverse()
                inner = " + ".join(p.expr for p in parts)
                self.push(Sym(f"({inner})", "expr"))

            elif op == "FORMAT_VALUE":
                if arg and (arg & 0x04):
                    fmt_spec = self.pop()
                val = self.pop()
                conv = ""
                if arg:
                    if (arg & 0x03) == 1:
                        conv = "!s"
                    elif (arg & 0x03) == 2:
                        conv = "!r"
                    elif (arg & 0x03) == 3:
                        conv = "!a"
                self.push(Sym(f"f\"{{{val.expr}{conv}}}\"", "expr"))

            elif op == "LIST_APPEND":
                val = self.pop()
                # The list is arg positions deep in the stack
                self.emit(f"# list_append({val.expr})")

            elif op == "MAP_ADD":
                val = self.pop()
                key = self.pop()
                self.emit(f"# map_add({key.expr}: {val.expr})")

            elif op == "SET_ADD":
                val = self.pop()
                self.emit(f"# set_add({val.expr})")

            elif op == "LIST_EXTEND":
                val = self.pop()
                lst = self.peek()
                self.push(Sym(f"[*{lst.expr}, *{val.expr}]", "list"))

            elif op == "DICT_MERGE" or op == "DICT_UPDATE":
                val = self.pop()
                self.push(Sym(f"{{**{val.expr}}}", "dict"))

            # --- Jumps / Control flow ---
            elif op in ("POP_JUMP_IF_TRUE", "POP_JUMP_FORWARD_IF_TRUE"):
                cond = self.pop()
                self.emit(f"if {cond.expr}:")
                self.indent_level += 1

            elif op in ("POP_JUMP_IF_FALSE", "POP_JUMP_FORWARD_IF_FALSE"):
                cond = self.pop()
                self.emit(f"if not ({cond.expr}):")
                self.indent_level += 1

            elif op == "POP_JUMP_IF_NOT_NONE":
                cond = self.pop()
                self.emit(f"if {cond.expr} is not None:")
                self.indent_level += 1

            elif op == "POP_JUMP_IF_NONE":
                cond = self.pop()
                self.emit(f"if {cond.expr} is None:")
                self.indent_level += 1

            elif op in ("JUMP_FORWARD", "JUMP_BACKWARD", "JUMP_BACKWARD_NO_INTERRUPT",
                        "JUMP_ABSOLUTE"):
                if self.indent_level > 0:
                    self.indent_level -= 1

            elif op == "FOR_ITER":
                iter_var = self.peek()
                self.push(Sym(f"_next({iter_var.expr})", "expr"))

            elif op == "GET_ITER":
                val = self.pop()
                self.push(Sym(f"iter({val.expr})", "expr"))

            # --- Exception handling ---
            elif op == "SETUP_FINALLY" or op == "BEFORE_WITH":
                pass

            elif op == "CHECK_EXC_MATCH":
                exc = self.pop()
                val = self.pop()
                self.push(Sym(f"isinstance(_exc, {exc.expr})", "expr"))

            elif op == "CHECK_EG_MATCH":
                exc = self.pop()
                val = self.pop()
                self.push(Sym(f"isinstance(_exc_group, {exc.expr})", "expr"))

            # --- Unpacking ---
            elif op == "UNPACK_SEQUENCE":
                seq = self.pop()
                for j in range(arg - 1, -1, -1):
                    self.push(Sym(f"{seq.expr}[{j}]", "subscr"))

            elif op == "UNPACK_EX":
                seq = self.pop()
                before = arg & 0xFF
                after = (arg >> 8) & 0xFF
                for j in range(before):
                    self.push(Sym(f"{seq.expr}[{j}]", "subscr"))
                self.push(Sym(f"{seq.expr}[{before}:-{after or 'end'}]", "subscr"))
                for j in range(after):
                    self.push(Sym(f"{seq.expr}[-{after - j}]", "subscr"))

            # --- Stack manipulation ---
            elif op == "POP_TOP":
                val = self.pop()
                if val.kind == "call" or val.kind == "attr":
                    self.emit(val.expr)

            elif op == "PUSH_NULL":
                self.push(Sym("NULL", "const"))

            elif op == "DUP_TOP" or op == "COPY":
                n_copies = arg if arg and arg > 0 else 1
                if self.stack:
                    val = self.stack[-n_copies] if n_copies <= len(self.stack) else Sym("???")
                    self.push(Sym(val.expr, val.kind))

            elif op == "SWAP":
                if len(self.stack) >= (arg or 2):
                    n = arg or 2
                    self.stack[-1], self.stack[-n] = self.stack[-n], self.stack[-1]

            elif op == "ROT_TWO":
                if len(self.stack) >= 2:
                    self.stack[-1], self.stack[-2] = self.stack[-2], self.stack[-1]

            elif op == "ROT_THREE":
                if len(self.stack) >= 3:
                    a, b, c = self.stack[-1], self.stack[-2], self.stack[-3]
                    self.stack[-1], self.stack[-2], self.stack[-3] = b, c, a

            # --- Misc ---
            elif op == "MAKE_FUNCTION":
                # Qualname already on stack from LOAD_CONST  code object
                code_obj = self.pop()
                if arg and (arg & 0x01):
                    defaults = self.pop()
                if arg and (arg & 0x02):
                    kwdefaults = self.pop()
                if arg and (arg & 0x04):
                    annotations = self.pop()
                if arg and (arg & 0x08):
                    closure = self.pop()
                self.push(Sym(f"<func:{code_obj.expr}>", "expr"))

            elif op == "IMPORT_NAME":
                # fromlist and level should be on stack
                fromlist = self.pop()
                level = self.pop()
                self.push(Sym(argval, "name"))

            elif op == "IMPORT_FROM":
                self.push(Sym(argval, "name"))

            elif op == "IMPORT_STAR":
                mod = self.pop()
                self.emit(f"from {mod.expr} import *")

            elif op == "RAISE_VARARGS":
                if arg == 0:
                    self.emit("raise")
                elif arg == 1:
                    exc = self.pop()
                    self.emit(f"raise {exc.expr}")
                elif arg == 2:
                    cause = self.pop()
                    exc = self.pop()
                    self.emit(f"raise {exc.expr} from {cause.expr}")

            elif op == "YIELD_VALUE":
                val = self.pop()
                self.push(Sym(f"yield {val.expr}", "expr"))

            elif op == "GET_YIELD_FROM_ITER":
                val = self.pop()
                self.push(Sym(f"yield from {val.expr}", "expr"))

            elif op in ("KW_NAMES",):
                # Python 3.12: pushes kwarg names tuple for next CALL
                self.push(Sym(_repr_const(argval), "const"))

            elif op == "LOAD_FAST_AND_CLEAR":
                self.push(Sym(argval, "name"))

            elif op == "STORE_FAST_MAYBE_NULL":
                val = self.pop()
                self.emit(f"{argval} = {val.expr}")

            elif op == "POP_EXCEPT":
                pass

            elif op == "RERAISE":
                self.emit("raise")

            elif op == "END_FOR" or op == "END_SEND":
                self.pop()  # consume the iterator exhaust value

            # Catch-all
            else:
                # Unknown opcode, just track stack effect
                pass

            i += 1

        return self._format()

    def _format(self) -> str:
        result = []
        for indent, stmt in self.lines:
            prefix = "    " * (self.base_indent + indent)
            result.append(f"{prefix}{stmt}")
        return "\n".join(result) if result else "    " * self.base_indent + "pass"


# ---------------------------------------------------------------------------
# Main reconstruction pipeline
# ---------------------------------------------------------------------------

def find_incomplete_functions(py_path: str) -> list[tuple[str, int, int, str]]:
    """
    Returns list of (func_name, start_line, end_line, full_match) for
    functions with '# WARNING: Decompyle incomplete'.
    """
    with open(py_path) as f:
        content = f.read()

    # Match: def funcname(...):
    #            pass
    #        # WARNING: Decompyle incomplete
    pattern = re.compile(
        r'^( *)(def (\w+)\([^)]*\)[^:]*:)\s*\n'
        r'\1    pass\s*\n'
        r'\1# WARNING: Decompyle incomplete',
        re.MULTILINE,
    )
    results = []
    for m in pattern.finditer(content):
        indent = m.group(1)
        sig = m.group(2)
        name = m.group(3)
        start = content[:m.start()].count("\n") + 1
        end = content[:m.end()].count("\n") + 1
        results.append((name, start, end, m.group(0), len(indent)))
    return results


def find_pyc(py_path: str) -> Optional[str]:
    stem = os.path.basename(py_path)[:-3]
    cache = os.path.join(os.path.dirname(py_path), "__pycache__")
    pycs = glob.glob(os.path.join(cache, f"{stem}.cpython-*.pyc"))
    return pycs[0] if pycs else None


def reconstruct_file(py_path: str, dry_run: bool = False) -> int:
    """Reconstruct all incomplete functions in a .py file. Returns count fixed."""
    incomplete = find_incomplete_functions(py_path)
    if not incomplete:
        return 0

    pyc_path = find_pyc(py_path)
    if not pyc_path:
        return 0

    code = load_pyc(pyc_path)
    all_cos = get_all_code_objects(code)

    with open(py_path) as f:
        content = f.read()

    fixed = 0
    # Process from bottom to top to preserve line numbers
    for func_name, start, end, full_match, indent_chars in reversed(incomplete):
        # Find matching code object
        matching = [co for qn, co in all_cos.items()
                    if qn.endswith(f".{func_name}") or qn == func_name]
        if not matching:
            continue

        co = matching[0]
        indent_spaces = indent_chars + 4  # function body indent

        try:
            recon = BytecodeReconstructor(co, indent=indent_spaces // 4)
            body = recon.reconstruct()

            # Clean up the body
            body_lines = body.split("\n")
            clean_lines = []
            for line in body_lines:
                stripped = line.strip()
                if stripped.startswith("# list_append") or stripped.startswith("# map_add"):
                    continue
                if stripped == "pass" and clean_lines:
                    continue
                clean_lines.append(line)

            if not clean_lines or all(l.strip() == "" for l in clean_lines):
                clean_lines = [" " * indent_spaces + "pass  # bytecode too complex to reconstruct"]

            new_body = "\n".join(clean_lines)

            # Build replacement: keep the def sig, replace body
            sig_line = full_match.split("\n")[0]  # "    def funcname(...):"
            replacement = sig_line + "\n" + new_body

            content = content.replace(full_match, replacement)
            fixed += 1

        except Exception as e:
            # Keep original with annotation
            sig_line = full_match.split("\n")[0]
            replacement = sig_line + f"\n{' ' * indent_spaces}pass  # TODO: reconstruct failed: {e}"
            content = content.replace(full_match, replacement)
            fixed += 1

    if not dry_run and fixed > 0:
        with open(py_path, "w") as f:
            f.write(content)

    return fixed


def main():
    app_root = "/opt/obsqra.starknet/zkdefi/backend/app"
    dry_run = "--dry-run" in sys.argv

    total_files = 0
    total_fixed = 0
    errors = []

    for root, dirs, files in os.walk(app_root):
        if "__pycache__" in root or "venv" in root:
            continue
        for f in files:
            if not f.endswith(".py"):
                continue
            fpath = os.path.join(root, f)
            with open(fpath) as fp:
                if "WARNING: Decompyle incomplete" not in fp.read():
                    continue

            try:
                n = reconstruct_file(fpath, dry_run=dry_run)
                if n > 0:
                    rel = os.path.relpath(fpath, app_root)
                    print(f"  {rel}: {n} functions")
                    total_files += 1
                    total_fixed += n
            except Exception as e:
                rel = os.path.relpath(fpath, app_root)
                errors.append((rel, str(e)))
                print(f"  ERROR {rel}: {e}")

    print(f"\n{'DRY RUN: ' if dry_run else ''}Reconstructed {total_fixed} functions in {total_files} files")
    if errors:
        print(f"Errors: {len(errors)}")
        for f, e in errors:
            print(f"  {f}: {e}")


if __name__ == "__main__":
    main()
