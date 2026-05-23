PID_FILE=.run.pid
VITE=./node_modules/.bin/vite
PORT?=5173
NPM?=npm
NPM_CACHE?=.npm-cache

.PHONY: build dev start stop clean test install

install node_modules:
	$(NPM) install --cache $(NPM_CACHE)

build: node_modules
	$(NPM) run build

dev: node_modules
	$(VITE) --port $(PORT) --host

start: build
	mkdir -p logs
	python3 -c 'import subprocess; out=open("logs/quant-frontend.out","ab",buffering=0); p=subprocess.Popen(["$(VITE)","preview","--port","$(PORT)","--host","--strictPort"], stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, start_new_session=True, close_fds=True); open("$(PID_FILE)","w").write(str(p.pid)+"\n")'
	@echo "✓ quant-frontend started (pid=$$(cat $(PID_FILE))), logs at gateway/quant-frontend/logs/quant-frontend.out"

stop:
	@if [ -f $(PID_FILE) ]; then kill $$(cat $(PID_FILE)) 2>/dev/null || true; rm -f $(PID_FILE); echo "✓ quant-frontend stopped"; else echo "(no $(PID_FILE), nothing to stop)"; fi

test:
	@echo "No tests configured"

clean:
	rm -rf dist $(PID_FILE) logs $(NPM_CACHE)
