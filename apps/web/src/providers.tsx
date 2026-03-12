import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

export function AppProviders({ children, client }: PropsWithChildren<{ client?: QueryClient }>) {
  return (
    <QueryClientProvider client={client ?? createAppQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}
