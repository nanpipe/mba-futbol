-- ════════════════════════════════════════════════════════════════════════════
-- El registro dejaba que el cliente eligiera su IP y su club.
--
-- La página de registro mandaba ip_registro y club_id dentro del metadata de
-- signUp, y handle_new_user() los copiaba al perfil tal cual. Los dos venían
-- del navegador, así que los dos se podían inventar:
--
--   ip_registro → la regla de "una cuenta por IP" se salta mandando una IP
--                 falsa: la siguiente cuenta desde la IP real no encuentra
--                 nada guardado con esa IP y pasa.
--   club_id     → con un uuid ajeno la cuenta nace dentro de otro club.
--
-- El trigger ya no lee ninguno de los dos. El perfil nace sin IP y en el club
-- por defecto; /api/auth/stamp-registro los sella después, con la IP que ve el
-- servidor en las cabeceras del proxy y el club que resolvió el middleware por
-- el dominio. Ese endpoint solo escribe sobre el usuario de la sesión y solo
-- mientras ip_registro siga NULL, así que no se puede re-sellar ni sellar a otro.
--
-- El username se sigue leyendo del metadata a propósito: el jugador lo elige,
-- ya se valida contra profiles antes del signUp, y no da ningún privilegio.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    username,
    ip_registro,
    club_id,
    role,
    aprobado
  ) VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    NULL,                                          -- la sella el servidor
    'a0000000-0000-0000-0000-000000000001'::uuid,  -- idem, según el dominio
    'player',
    false
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
