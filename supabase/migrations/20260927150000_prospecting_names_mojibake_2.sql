-- Faxina nos nomes da Prospecção, parte 4 (continuação da parte 3, mesmo dia).
--
-- 1) Um nome ficou de fora da lista anterior por engano ("Elisângela").
-- 2) Uma segunda leva de "?" decorativo (leading/trailing, não achada pela busca anterior
--    porque não exigia contato direto com outra letra — ex.: "Carol ?", "Kezia Santana?")
--    é removida do mesmo jeito: só quando o "?" está na PONTA do nome (ou é toda a "sobra"
--    depois de tirar um nome já completo), nunca quando está no MEIO grudado em outra
--    palavra (esse é o caso arriscado de letra perdida, já tratado à parte na parte 3).
-- 3) Quem sobra só um "X"/símbolo depois de tirar o "?" vira "Sem Nome" (mesmo critério
--    de sempre: uma letra solta não é nome).
--
-- Fora do escopo, como antes: "Gabriel??Mobilemaker|Gerenc. Ads??" (nome + tag de negócio
-- colados) e "Morena Flor R.B.N.L.C?X" (sigla ilegível) — não mexidos.
--
-- Match exato por "name =": rodar de novo é inofensivo.

with correcoes(antes, depois) as (
  values
    ('Elisã¢Ngela Bispo Duarte Siman', 'Elisângela Bispo Duarte Siman'),
    ('? Gabriel Ferreira ?', 'Gabriel Ferreira'),
    ('? Lili ?', 'Lili'),
    ('Alexandre ??', 'Alexandre'),
    ('Amanda Costa ??', 'Amanda Costa'),
    ('Biah ?', 'Biah'),
    ('Biel ( Gabriel?)', 'Biel (Gabriel)'),
    ('Carol ?', 'Carol'),
    ('Carol Guimaro Azevedo Hai??', 'Carol Guimaro Azevedo Hai'),
    ('Claudia ??', 'Claudia'),
    ('Dielis...??', 'Dielis'),
    ('Dulci ??', 'Dulci'),
    ('Franciele e Mozao ????', 'Franciele e Mozao'),
    ('Gêêh Souza ??X', 'Gêêh Souza'),
    ('Gustavo (?)', 'Gustavo'),
    ('Kezia Santana?', 'Kezia Santana'),
    ('Li e Loló ?X', 'Li e Loló'),
    ('Maria ?', 'Maria'),
    ('Marlenys Hernández??', 'Marlenys Hernández'),
    ('Nayane Damasceno??', 'Nayane Damasceno'),
    ('Priscilla Nayara?', 'Priscilla Nayara'),
    ('Samara ?', 'Samara'),
    ('Simone Azevedo?', 'Simone Azevedo'),
    ('Simone Francisca.?', 'Simone Francisca'),
    ('Suzy Rob?', 'Suzy Rob'),
    ('Thaís Campos ?', 'Thaís Campos'),
    ('Yara Cristina ??', 'Yara Cristina')
)
update public.prospecting_contacts p
set name = c.depois, updated_at = now()
from correcoes c
where p.name = c.antes;

update public.prospecting_contacts
set name = 'Sem Nome', updated_at = now()
where name in ('? Deus e A Nossa Força????', '??X', '?X', '?X?');
