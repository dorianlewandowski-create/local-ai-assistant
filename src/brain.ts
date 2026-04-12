import { routerService } from './services/RouterService'

export const brain = {
  query: routerService.queryBrain.bind(routerService),
}
