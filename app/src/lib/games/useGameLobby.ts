import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Database, GameMode, GameSettings, PlayerRole } from '@/types/database';
import { supabase } from '@/lib/supabase/client';

export type Game = Database['public']['Tables']['games']['Row'];
export type GamePlayer = Database['public']['Tables']['game_players']['Row'];
export type LobbyPlayer = GamePlayer & Pick<Database['public']['Tables']['profiles']['Row'], 'display_name' | 'nickname' | 'avatar_url' | 'marker_color'>;

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as T;
}

export function useCreateGame() {
  return useMutation({
    mutationFn: ({ name, mode, settings }: { name: string; mode: GameMode; settings: GameSettings }) =>
      rpc<Game>('create_game', { p_name: name.trim(), p_mode: mode, p_settings: settings }),
  });
}

export function useJoinGame() {
  return useMutation({ mutationFn: (code: string) => rpc<Game>('join_game', { p_code: code.trim().toUpperCase() }) });
}

export function useGameLobby(gameId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();
  const key = useMemo(() => ['game-lobby', gameId] as const, [gameId]);
  const query = useQuery({
    queryKey: key,
    enabled: !!gameId,
    queryFn: async () => {
      const [{ data: game, error: gameError }, { data: players, error: playersError }] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId!).single(),
        supabase.from('game_players').select('*, profiles!inner(display_name,nickname,avatar_url,marker_color)').eq('game_id', gameId!).order('joined_at'),
      ]);
      if (gameError) throw gameError;
      if (playersError) throw playersError;
      const lobbyPlayers = (players as unknown as (GamePlayer & { profiles: Pick<LobbyPlayer, 'display_name' | 'nickname' | 'avatar_url' | 'marker_color'> })[]).map(({ profiles, ...player }) => ({ ...player, ...profiles }));
      return { game: game as Game, players: lobbyPlayers as LobbyPlayer[] };
    },
  });

  useEffect(() => {
    if (!gameId) return;
    const channel = supabase.channel(`lobby:${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => queryClient.invalidateQueries({ queryKey: key }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` }, () => queryClient.invalidateQueries({ queryKey: key }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gameId, key, queryClient]);

  useEffect(() => {
    if (!gameId || !userId) return;
    const beat = () => rpc<Game>('heartbeat_game', { p_game_id: gameId }).catch(() => undefined);
    beat();
    const id = setInterval(beat, 20_000);
    return () => clearInterval(id);
  }, [gameId, userId]);

  useEffect(() => {
    const game = query.data?.game;
    if (!gameId || !game || !['countdown', 'head_start', 'active'].includes(game.status)) return;
    const id = setInterval(() => rpc<Game>('advance_game_state', { p_game_id: gameId }).catch(() => undefined), 1_000);
    return () => clearInterval(id);
  }, [gameId, query.data?.game]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const setReady = useMutation({
    mutationFn: () => rpc<void>('set_player_ready', { p_game_id: gameId, p_ready: !query.data?.players.find((p) => p.user_id === userId)?.is_ready }),
    onSuccess: refresh,
  });
  return {
    ...query,
    setReady,
    setRole: (playerId: string, role: PlayerRole) => rpc<void>('set_player_role', { p_game_id: gameId, p_user_id: playerId, p_role: role }).then(refresh),
    start: (force = false) => rpc<Game>('start_game', { p_game_id: gameId, p_force: force }).then(refresh),
    manage: (actionName: 'pause' | 'resume' | 'end' | 'transfer_host' | 'kick', targetId?: string) => rpc<Game>('manage_game', { p_game_id: gameId, p_action: actionName, p_target_user_id: targetId ?? null }).then(refresh),
  };
}
