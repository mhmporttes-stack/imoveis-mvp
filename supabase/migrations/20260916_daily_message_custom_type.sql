-- Terceira categoria de card ("Meus", valor interno 'custom') na Biblioteca
-- de cards da Mensagem do Dia, entre Bíblicos e Reflexivos — pra separar
-- cards escritos pelo próprio dono dos importados. Não muda o rodízio
-- automático diário (settings.contentType continua só biblical/reflection/
-- alternate); "Meus" fica, por enquanto, fora do sorteio automático — só
-- organização/gestão manual na biblioteca, igual pedido.
alter table public.daily_message_cards drop constraint daily_message_cards_type_check;
alter table public.daily_message_cards add constraint daily_message_cards_type_check check (type in ('biblical', 'reflection', 'custom'));
