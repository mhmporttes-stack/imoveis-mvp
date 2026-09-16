-- "Informacoes internas" da captacao: reaproveita owner_name/owner_phone/
-- street/number/neighborhood/city/state/intended_price ja existentes (nada
-- duplicado) e so adiciona o que realmente falta: complemento do endereco,
-- CEP e um campo de anotacoes de uso interno da equipe (distinto de
-- "notes", que e o comentario que o proprio proprietario preenche no
-- formulario publico de captacao). Todas nullable, sem default -- nao
-- quebra registros existentes.
alter table public.captacoes add column if not exists complement text;
alter table public.captacoes add column if not exists cep text;
alter table public.captacoes add column if not exists admin_notes text;
