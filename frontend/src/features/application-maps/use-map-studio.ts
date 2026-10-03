"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { studioApi } from "./studio-api";
import type { Options, Revision } from "./studio-types";
export function useMapStudio(
  mapId: string,
  scope: string | undefined,
  options: Options,
  nodeId: string,
) {
  const client = useQueryClient();
  const studio = useQuery({
    queryKey: ["map-studio", scope, mapId, options],
    queryFn: ({ signal }) => studioApi.load(mapId, options, signal),
    retry: false,
  });
  const impact = useQuery({
    queryKey: ["map-impact", scope, mapId, nodeId],
    enabled: !!nodeId,
    queryFn: ({ signal }) => studioApi.impact(mapId, nodeId, signal),
    retry: false,
  });
  const save = useMutation({
    mutationFn: (
      body: Omit<Revision, "id" | "version" | "createdAt"> & {
        expectedVersion: number;
      },
    ) => studioApi.save(mapId, body),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["map-studio", scope, mapId] }),
  });
  return { studio, impact, save };
}
