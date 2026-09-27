-- Faxina nos nomes da Prospecção, parte 3 (pedido do dono, 2026-09-27).
--
-- Conserto de ~30 nomes com acentuação corrompida na importação ("mojibake"), lidos e
-- reconstruídos manualmente (a reversão matemática simples Latin1<->UTF8 falha por byte
-- inválido em parte destes casos — ver PARTE 2 da faxina anterior). Cada linha só é
-- atualizada se o texto ainda for EXATAMENTE o valor corrompido lido (match exato por
-- "name ="), então rodar de novo é inofensivo — não acerta nada que já tenha mudado.
--
-- Também: 2 valores que não eram nome nenhum (um link do Facebook e um texto só de
-- símbolo) viram "Sem Nome", mesmo critério das faxinas anteriores.

with correcoes(antes, depois) as (
  values
    ('Tã¢Nia Fetchir', 'Tânia Fetchir'),
    ('Maria Josã© de Andrade', 'Maria José de Andrade'),
    ('Jos? Carlos Lima Pinto', 'José Carlos Lima Pinto'),
    ('Roberto Josã? do Nascimento', 'Roberto José do Nascimento'),
    ('Andrã?Ia Scorsafava Marques Vilela', 'Andréia Scorsafava Marques Vilela'),
    ('Andre?Ia Sartorelli', 'Andréia Sartorelli'),
    ('Patricia Andrã?Ia Peralta Marques', 'Patricia Andréia Peralta Marques'),
    ('Aure?Lio Fiorini', 'Aurélio Fiorini'),
    ('De?Bora Cristina', 'Débora Cristina'),
    ('Leti?Cia de Jesus', 'Letícia de Jesus'),
    ('Valã?Ria Miranda de Castro', 'Valéria Miranda de Castro'),
    ('Rogã?Rio Minoru Akutagawa', 'Rogério Minoru Akutagawa'),
    ('Dr. Joa?O Vitor Sandrini', 'Dr. João Vitor Sandrini'),
    ('Joã£O Augusto da Silva', 'João Augusto da Silva'),
    ('Naila Martins Damiã£O', 'Naila Martins Damião'),
    ('Silvia Regina Pereira da Rocha Salomã£O', 'Silvia Regina Pereira da Rocha Salomão'),
    ('Elaine Cristina de Souza Franã?A', 'Elaine Cristina de Souza França'),
    ('Joyce Gonã?Alves Fernandes de Oliveira', 'Joyce Gonçalves Fernandes de Oliveira'),
    ('Jurandir Gonã?Alves Junior', 'Jurandir Gonçalves Junior'),
    ('Silvia de Freitas Gonã?Alves Silva', 'Silvia de Freitas Gonçalves Silva'),
    ('Talita Karina Gonã§Alves', 'Talita Karina Gonçalves'),
    ('Alexandre Roberto Lourenã§Ao', 'Alexandre Roberto Lourenção'),
    ('Simone Cristina Lourenã§O da Silva', 'Simone Cristina Lourenção da Silva'),
    ('Ewerton Josã? Batista Mastromano', 'Ewerton José Batista Mastromano'),
    ('Fernanda Aguiar Milarã©', 'Fernanda Aguiar Milaré'),
    ('Espac?O Rosi Garcia', 'Espaço Rosi Garcia'),
    ('Carolinne?', 'Carolinne'),
    ('Joicynha??', 'Joicynha'),
    ('Raissa??', 'Raissa'),
    ('Rayssa?', 'Rayssa'),
    ('Line?', 'Line')
)
update public.prospecting_contacts p
set name = c.depois, updated_at = now()
from correcoes c
where p.name = c.antes;

update public.prospecting_contacts
set name = 'Sem Nome', updated_at = now()
where name in (
  'Https://M.Facebook.Com/Story.Php?Story Fbid=3702261453118953&Id=271043892907410',
  '?X?Vanguh??Gl??X?'
);
