import json, subprocess, sys

F = "/Users/abdullahatrash/flowleap/flowleap-cli/target/release/flowleap"

CASES = [
    ("A flexible photovoltaic device using a perovskite light-absorbing layer on a polymer substrate",
     'ta=perovskite AND ta=flexible AND ic=H01L'),
    ("Using machine learning to analyse patent claims and find prior art",
     'ta="prior art" AND ta="machine learning"'),
    ("Wireless charging for electric vehicles using inductive coupling with foreign-object detection",
     'ta="foreign object" AND ta=charging AND ic=H02J'),
    ("A CRISPR-based method for editing plant genomes to improve drought resistance",
     'ta=CRISPR AND ta=drought AND ic=C12N'),
    ("Solid-state battery electrolyte made from a sulfide glass ceramic",
     'ta="solid electrolyte" AND ta=sulfide AND ic=H01M'),
    ("A drone that inspects wind turbine blades and detects cracks automatically",
     'ta="wind turbine blade" AND ta=inspection'),
]

def run(args, timeout=180):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.stdout
    except Exception as e:
        return json.dumps({"error": str(e)})

def total_for(cql):
    """Result count for a CQL query, or an error string."""
    out = run([F, "api", "request", "post", "/v1/patent-search",
               "--body", json.dumps({"query": cql, "range": "1-1"}), "--json"])
    try:
        d = json.loads(out)
    except Exception:
        return None, "unparseable"
    b = d.get("body")
    if not isinstance(b, dict):
        return None, f"status {d.get('status')}"
    if not b.get("success", True) and b.get("error"):
        return None, str(b["error"])[:80]
    if b.get("error"):
        return None, str(b["error"])[:80]
    return b.get("total"), None

def server_cql(desc):
    out = run([F, "--json", "patent", "build-query", desc, "--allow-external-processing"])
    try:
        d = json.loads(out)
    except Exception:
        return None, "unparseable"
    # unwrap common shapes
    for path in (("strategy", "recommended_cql"), ("body", "strategy", "recommended_cql")):
        cur = d
        ok = True
        for k in path:
            if isinstance(cur, dict) and k in cur:
                cur = cur[k]
            else:
                ok = False; break
        if ok and isinstance(cur, str):
            return cur, None
    return None, json.dumps(d)[:120]

rows = []
for desc, mine in CASES:
    my_total, my_err = total_for(mine)
    srv, srv_err = server_cql(desc)
    srv_total, srv_terr = (None, srv_err) if srv is None else total_for(srv)
    rows.append({"desc": desc, "mine": mine, "my_total": my_total, "my_err": my_err,
                 "srv": srv, "srv_total": srv_total, "srv_err": srv_terr})
    print(f"--- {desc[:62]}")
    print(f"    AGENT : {mine}")
    print(f"            total={my_total}{'  ERR='+my_err if my_err else ''}")
    print(f"    SERVER: {srv}")
    print(f"            total={srv_total}{'  ERR='+str(srv_terr) if srv_terr else ''}")
    sys.stdout.flush()

json.dump(rows, open("/Users/abdullahatrash/.claude/jobs/2d474a43/tmp/phase2-results.json", "w"), indent=1)
print("\nsaved results")
