import json,os,socket,sys,time
request=json.loads(sys.stdin.readline())
if request.get('sleep') or request.get('spec'):
    time.sleep(600)
result={}
for name,path in [('root','/blocked'),('input','/input/blocked')]:
    try:open(path,'w').close();result[name]=False
    except OSError:result[name]=True
try:socket.create_connection(('1.1.1.1',443),timeout=.5);result['network']=False
except OSError:result['network']=True
try:
    with open('/output/full','wb') as f:
        for _ in range(32):f.write(b'x'*1048576)
    result['disk']=False
except OSError:result['disk']=True
result['uid']=os.getuid()
result['cgroup']={name:open('/sys/fs/cgroup/'+name).read().strip() for name in ['memory.max','pids.max','cpu.max']}
result['status']=open('/proc/self/status').read()
result['env']=dict(os.environ)
print(json.dumps(result),flush=True)
sys.stdin.readline()
