"""
Grava appVerMin='e16' (fix da escrita fantasma: montarGravacao não manda mais
{} pro Firestore quando um campo não teve edição — 22/09/2026) nos 3 docs de
fábrica em ls_pe (manutt, tarragona, tchwm-industria-e-comercio-de-calcados-ltda)
e no doc global ls_pe_config/loja (fonte do overlay bloqueante de UI — ver
index.html, bloco "GATE TOTAL DE VERSÃO").

Cada gravação é uma transação que só toca o campo appVerMin (e, nos docs de
fábrica, faz ArrayUnion de UMA entrada de historico) — nunca lê/reescreve
estoque, produzindo, ordens etc. Não toca no doc legado (_ujl3p9sjjv).

Só roda depois de confirmar via curl que o GitHub Pages já serve app-ver e16
(ver CACA_FANTASMA_22SET.md) — gravar appVerMin antes disso travaria quem
ainda não tem como atualizar.
"""
import time
import firebase_admin
from firebase_admin import credentials, firestore

CRED_PATH = "/home/loretto-scarpa/sandbox-central-unica/.secrets/firebase-admin.json"
VER = "e16"
FABRICAS = ["manutt", "tarragona", "tchwm-industria-e-comercio-de-calcados-ltda"]

firebase_admin.initialize_app(credentials.Certificate(CRED_PATH))
db = firestore.client()


def grava_fabrica(did):
    ref = db.collection("ls_pe").document(did)

    @firestore.transactional
    def tx_fn(tx):
        snap = ref.get(transaction=tx)
        if not snap.exists:
            print(f"  [{did}] doc não existe, pulando")
            return
        entry = {
            "ts": int(time.time() * 1000),
            "por": "Loretto (automático)",
            "tipo": "gate de versão e16 — fix escrita fantasma (produzindo zerando sem log)",
            "mudancas": [],
        }
        tx.set(
            ref,
            {
                "appVerMin": VER,
                "historico": firestore.ArrayUnion([entry]),
            },
            merge=True,
        )

    tx_fn(db.transaction())
    print(f"  [{did}] appVerMin={VER} gravado")


def grava_config_global():
    ref = db.collection("ls_pe_config").document("loja")

    @firestore.transactional
    def tx_fn(tx):
        tx.set(ref, {"appVerMin": VER}, merge=True)

    tx_fn(db.transaction())
    print(f"  [ls_pe_config/loja] appVerMin={VER} gravado")


print("Gravando appVerMin nos docs de fábrica:")
for fid in FABRICAS:
    grava_fabrica(fid)

print("Gravando appVerMin no config global (fonte do overlay de UI):")
grava_config_global()

print("Conferindo:")
for fid in FABRICAS:
    d = db.collection("ls_pe").document(fid).get().to_dict() or {}
    print(f"  ls_pe/{fid}: appVerMin={d.get('appVerMin')!r} historico(len)={len(d.get('historico') or [])}")
d = db.collection("ls_pe_config").document("loja").get().to_dict() or {}
print(f"  ls_pe_config/loja: appVerMin={d.get('appVerMin')!r}")
