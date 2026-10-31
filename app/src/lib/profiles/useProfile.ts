import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/types/database';
import { supabase } from '../supabase/client';

export type Profile = Database['public']['Tables']['profiles']['Row'];

/** The exact update payload shape accepted by the typed Supabase client. */
export type ProfilePatch = Database['public']['Tables']['profiles']['Update'];

/**
 * Fetch the signed-in player's profile row.
 * The row itself is created server-side by the `on_auth_user_created`
 * trigger, so we only ever read it here; edits go through useUpdateProfile.
 */
export function useProfile(userId: string | null | undefined) {
  return useQuery<Profile>({
    queryKey: ['profile', userId],
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId!)
        .single();

      if (error) throw error;
      return data;
    },
  });
}

/**
 * Edits are scoped server-side by the RLS policy (a user can edit only their
 * own profile) and client-side by the `.eq('id', userId)` filter.
 */
export function useUpdateProfile(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: ProfilePatch) => {
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', userId!)
        .select()
        .single();

      if (error) throw error;
      return data as Profile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });
}
