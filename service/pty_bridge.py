"""JSON-lines bridge to a real Unix PTY; supervisor owns its lifetime."""
import base64, fcntl, json, os, pty, select, signal, struct, sys, termios
pid, fd = pty.fork()
if pid == 0:
    os.chdir(sys.argv[1])
    os.execvpe(sys.argv[2], sys.argv[2:], os.environ)

def send(data):
    print(json.dumps(data), flush=True)

def finish(*_):
    try: os.killpg(pid, signal.SIGHUP)
    except ProcessLookupError: pass
    try: os.close(fd)
    except OSError: pass
    sys.exit(0)

signal.signal(signal.SIGTERM, finish)
pending = b''
try:
    while True:
        ready, _, _ = select.select([fd, sys.stdin], [], [], .2)
        if fd in ready:
            try: data = os.read(fd, 32768)
            except OSError: break
            if not data: break
            send({'data': base64.b64encode(data).decode()})
        if sys.stdin in ready:
            chunk = os.read(sys.stdin.fileno(), 65536)
            if not chunk: finish()
            pending += chunk
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                try:
                    message = json.loads(line)
                    if 'input' in message: os.write(fd, base64.b64decode(message['input']))
                    if 'cols' in message:
                        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', message['rows'], message['cols'], 0, 0))
                except (ValueError, KeyError): pass
    _, status = os.waitpid(pid, 0)
    send({'exit': os.waitstatus_to_exitcode(status)})
finally:
    finish()
