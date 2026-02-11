import { useQuery } from "@tanstack/react-query";

interface Profile {
  timezone?: string;
  language?: string;
}

export function useTimezone() {
  const accessToken = localStorage.getItem('accessToken');
  
  const { data: profile } = useQuery<Profile>({
    queryKey: ['/api/account/profile'],
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });

  const timezone = profile?.timezone || 'Asia/Seoul';
  const language = profile?.language || 'ko';

  return { timezone, language };
}
