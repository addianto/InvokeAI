import { RootState } from 'app/store/store';
import {
  CompelInvocation,
  Graph,
  IterateInvocation,
  LatentsToImageInvocation,
  NoiseInvocation,
  RandomIntInvocation,
  RangeOfSizeInvocation,
  TextToLatentsInvocation,
} from 'services/api';
import { NonNullableGraph } from 'features/nodes/types/types';
import { addControlNetToLinearGraph } from '../addControlNetToLinearGraph';

const POSITIVE_CONDITIONING = 'positive_conditioning';
const NEGATIVE_CONDITIONING = 'negative_conditioning';
const TEXT_TO_LATENTS = 'text_to_latents';
const LATENTS_TO_IMAGE = 'latents_to_image';
const NOISE = 'noise';
const RANDOM_INT = 'rand_int';
const RANGE_OF_SIZE = 'range_of_size';
const ITERATE = 'iterate';

/**
 * Builds the Text to Image tab graph.
 */
export const buildTextToImageGraph = (state: RootState): Graph => {
  const {
    positivePrompt,
    negativePrompt,
    model,
    cfgScale: cfg_scale,
    scheduler,
    steps,
    width,
    height,
    iterations,
    seed,
    shouldRandomizeSeed,
  } = state.generation;

  const graph: NonNullableGraph = {
    nodes: {},
    edges: [],
  };

  // Create the conditioning, t2l and l2i nodes
  const positiveConditioningNode: CompelInvocation = {
    id: POSITIVE_CONDITIONING,
    type: 'compel',
    prompt: positivePrompt,
    model,
  };

  const negativeConditioningNode: CompelInvocation = {
    id: NEGATIVE_CONDITIONING,
    type: 'compel',
    prompt: negativePrompt,
    model,
  };

  const textToLatentsNode: TextToLatentsInvocation = {
    id: TEXT_TO_LATENTS,
    type: 't2l',
    cfg_scale,
    model,
    scheduler,
    steps,
  };

  const latentsToImageNode: LatentsToImageInvocation = {
    id: LATENTS_TO_IMAGE,
    type: 'l2i',
    model,
  };

  // Add to the graph
  graph.nodes[POSITIVE_CONDITIONING] = positiveConditioningNode;
  graph.nodes[NEGATIVE_CONDITIONING] = negativeConditioningNode;
  graph.nodes[TEXT_TO_LATENTS] = textToLatentsNode;
  graph.nodes[LATENTS_TO_IMAGE] = latentsToImageNode;

  // Connect them
  graph.edges.push({
    source: { node_id: POSITIVE_CONDITIONING, field: 'conditioning' },
    destination: {
      node_id: TEXT_TO_LATENTS,
      field: 'positive_conditioning',
    },
  });

  graph.edges.push({
    source: { node_id: NEGATIVE_CONDITIONING, field: 'conditioning' },
    destination: {
      node_id: TEXT_TO_LATENTS,
      field: 'negative_conditioning',
    },
  });

  graph.edges.push({
    source: { node_id: TEXT_TO_LATENTS, field: 'latents' },
    destination: {
      node_id: LATENTS_TO_IMAGE,
      field: 'latents',
    },
  });

  /**
   * Now we need to handle iterations and random seeds. There are four possible scenarios:
   * - Single iteration, explicit seed
   * - Single iteration, random seed
   * - Multiple iterations, explicit seed
   * - Multiple iterations, random seed
   *
   * They all have different graphs and connections.
   */

  // Single iteration, explicit seed
  if (!shouldRandomizeSeed && iterations === 1) {
    // Noise node using the explicit seed
    const noiseNode: NoiseInvocation = {
      id: NOISE,
      type: 'noise',
      seed: seed,
      width,
      height,
    };

    graph.nodes[NOISE] = noiseNode;

    // Connect noise to l2l
    graph.edges.push({
      source: { node_id: NOISE, field: 'noise' },
      destination: {
        node_id: TEXT_TO_LATENTS,
        field: 'noise',
      },
    });
  }

  // Single iteration, random seed
  if (shouldRandomizeSeed && iterations === 1) {
    // Random int node to generate the seed
    const randomIntNode: RandomIntInvocation = {
      id: RANDOM_INT,
      type: 'rand_int',
    };

    // Noise node without any seed
    const noiseNode: NoiseInvocation = {
      id: NOISE,
      type: 'noise',
      width,
      height,
    };

    graph.nodes[RANDOM_INT] = randomIntNode;
    graph.nodes[NOISE] = noiseNode;

    // Connect random int to the seed of the noise node
    graph.edges.push({
      source: { node_id: RANDOM_INT, field: 'a' },
      destination: {
        node_id: NOISE,
        field: 'seed',
      },
    });

    // Connect noise to t2l
    graph.edges.push({
      source: { node_id: NOISE, field: 'noise' },
      destination: {
        node_id: TEXT_TO_LATENTS,
        field: 'noise',
      },
    });
  }

  // Multiple iterations, explicit seed
  if (!shouldRandomizeSeed && iterations > 1) {
    // Range of size node to generate `iterations` count of seeds - range of size generates a collection
    // of ints from `start` to `start + size`. The `start` is the seed, and the `size` is the number of
    // iterations.
    const rangeOfSizeNode: RangeOfSizeInvocation = {
      id: RANGE_OF_SIZE,
      type: 'range_of_size',
      start: seed,
      size: iterations,
    };

    // Iterate node to iterate over the seeds generated by the range of size node
    const iterateNode: IterateInvocation = {
      id: ITERATE,
      type: 'iterate',
    };

    // Noise node without any seed
    const noiseNode: NoiseInvocation = {
      id: NOISE,
      type: 'noise',
      width,
      height,
    };

    // Adding to the graph
    graph.nodes[RANGE_OF_SIZE] = rangeOfSizeNode;
    graph.nodes[ITERATE] = iterateNode;
    graph.nodes[NOISE] = noiseNode;

    // Connect range of size to iterate
    graph.edges.push({
      source: { node_id: RANGE_OF_SIZE, field: 'collection' },
      destination: {
        node_id: ITERATE,
        field: 'collection',
      },
    });

    // Connect iterate to noise
    graph.edges.push({
      source: {
        node_id: ITERATE,
        field: 'item',
      },
      destination: {
        node_id: NOISE,
        field: 'seed',
      },
    });

    // Connect noise to t2l
    graph.edges.push({
      source: { node_id: NOISE, field: 'noise' },
      destination: {
        node_id: TEXT_TO_LATENTS,
        field: 'noise',
      },
    });
  }

  // Multiple iterations, random seed
  if (shouldRandomizeSeed && iterations > 1) {
    // Random int node to generate the seed
    const randomIntNode: RandomIntInvocation = {
      id: RANDOM_INT,
      type: 'rand_int',
    };

    // Range of size node to generate `iterations` count of seeds - range of size generates a collection
    const rangeOfSizeNode: RangeOfSizeInvocation = {
      id: RANGE_OF_SIZE,
      type: 'range_of_size',
      size: iterations,
    };

    // Iterate node to iterate over the seeds generated by the range of size node
    const iterateNode: IterateInvocation = {
      id: ITERATE,
      type: 'iterate',
    };

    // Noise node without any seed
    const noiseNode: NoiseInvocation = {
      id: NOISE,
      type: 'noise',
      width,
      height,
    };

    // Adding to the graph
    graph.nodes[RANDOM_INT] = randomIntNode;
    graph.nodes[RANGE_OF_SIZE] = rangeOfSizeNode;
    graph.nodes[ITERATE] = iterateNode;
    graph.nodes[NOISE] = noiseNode;

    // Connect random int to the start of the range of size so the range starts on the random first seed
    graph.edges.push({
      source: { node_id: RANDOM_INT, field: 'a' },
      destination: { node_id: RANGE_OF_SIZE, field: 'start' },
    });

    // Connect range of size to iterate
    graph.edges.push({
      source: { node_id: RANGE_OF_SIZE, field: 'collection' },
      destination: {
        node_id: ITERATE,
        field: 'collection',
      },
    });

    // Connect iterate to noise
    graph.edges.push({
      source: {
        node_id: ITERATE,
        field: 'item',
      },
      destination: {
        node_id: NOISE,
        field: 'seed',
      },
    });

    // Connect noise to t2l
    graph.edges.push({
      source: { node_id: NOISE, field: 'noise' },
      destination: {
        node_id: TEXT_TO_LATENTS,
        field: 'noise',
      },
    });
  }

  addControlNetToLinearGraph(graph, TEXT_TO_LATENTS, state);

  return graph;
};
