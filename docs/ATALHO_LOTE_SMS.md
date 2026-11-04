# Atalho do iPhone — Lote de SMS (dono, 2026-11-04)

Envia o Lote de SMS pelo iPhone **sem abrir o app Mensagens**, por um Atalho (app Atalhos). O CRM nunca envia SMS: só entrega o texto
e registra o envio que o iPhone fez. Testado pelo dono: a ação "Enviar Mensagem" com "Mostrar ao executar" desligado envia direto.

## Como funciona
- `GET /api/atalhos/lote-sms` (cabeçalho `Authorization: Bearer sms_...`) → `{ items: [{ id, name, phone, text, text2, together }] }` (até 50).
- `POST /api/atalhos/lote-sms` `{ contactId }` → grava a 1ª enviada e devolve `sendId`; `{ sendId }` → grava a 2ª. Idempotente.
- Chave pessoal gerada no Lote de SMS › Para enviar › "Atalho do iPhone" (só o hash fica em `sms_shortcut_keys`; a antiga para de valer).
- Mesmas travas do Lote: perfil ativo (admin geral, gestor, corretor; associado não), Wi-Fi da imobiliária e WhatsApp conectado
  (PRO-18e/PRO-18j, `assertSmsBatchOffice`), limite por IP. Admin geral isento das duas últimas.

## Montar o Atalho
1. Atalhos › + › "Lote SMS".
2. Obter conteúdo de URL: endereço da tela, GET, cabeçalho `Authorization` = `Bearer ` + chave.
3. Obter valor do dicionário: `items`.
4. Repetir com cada item: obter `phone`, `text`, `id` do item → Enviar Mensagem (texto = text, destinatário = phone, Mostrar ao executar **desligado**) →
   Obter conteúdo de URL (mesmo endereço, POST, mesmo cabeçalho, corpo JSON `contactId` = id) → Esperar 8 s.
5. Opcional: 2ª mensagem depois (Enviar Mensagem com `text2` + POST `{ sendId }` com o `sendId` devolvido).

## Riscos
Enviar dezenas de mensagens seguidas pelo chip pode levar a operadora a limitar a linha; quem tem iPhone recebe como iMessage.
Migration: `20261104120000_sms_shortcut_keys.sql`.
