import { generate_layerdeployment } from '../src/layerDeploymentN.js'
import { ITerraformConfig } from '../src/types.js'

describe('generate_layerdeployment', () => {
  const mockConfig: ITerraformConfig[] = [
    { id: 'stack-1', depends_on: ['stack-2'] },
    { id: 'stack-2', depends_on: [] },
    { id: 'stack-3', depends_on: ['stack-1'] },
    { id: 'stack-4', depends_on: [] },
    { id: 'stack-5', depends_on: ['stack-3'] },
    { id: 'stack-6', depends_on: [] },
    { id: 'stack-7', depends_on: ['stack-5', 'stack-1'] }
  ]

  const mock_global_vars = {
    has_release_tag: true,
    stage: 'dev'
  }

  it('should assign layer 0 to configurations with no dependencies', () => {
    const result = generate_layerdeployment(mockConfig, 0, mock_global_vars, [])
    const expectedIds = ['stack-2', 'stack-4', 'stack-6']
    expect(result.map((item) => item.id)).toEqual(
      expect.arrayContaining(expectedIds)
    )
    result.forEach((item) => expect(item.layer).toBe(0))
  })

  it('should assign layer 1 to configurations dependent only on layer 0 stacks', () => {
    const layer0 = generate_layerdeployment(mockConfig, 0, mock_global_vars, [])
    const result = generate_layerdeployment(mockConfig, 1, mock_global_vars, [
      layer0
    ])
    const expectedIds = ['stack-1']
    expect(result.map((item) => item.id)).toEqual(
      expect.arrayContaining(expectedIds)
    )
    result.forEach((item) => expect(item.layer).toBe(1))
  })

  it('should assign layer 2 to configurations dependent only on layer 1 stacks', () => {
    const layer0 = generate_layerdeployment(mockConfig, 0, mock_global_vars, [])
    const layer1 = generate_layerdeployment(mockConfig, 1, mock_global_vars, [
      layer0
    ])
    const result = generate_layerdeployment(mockConfig, 2, mock_global_vars, [
      layer0,
      layer1
    ])
    const expectedIds = ['stack-3']
    expect(result.map((item) => item.id)).toEqual(
      expect.arrayContaining(expectedIds)
    )
    result.forEach((item) => expect(item.layer).toBe(2))
  })

  it('should return an empty array for layers with no eligible configurations', () => {
    const layer0 = generate_layerdeployment(mockConfig, 0, mock_global_vars, [])
    const layer1 = generate_layerdeployment(mockConfig, 1, mock_global_vars, [
      layer0
    ])
    const layer2 = generate_layerdeployment(mockConfig, 2, mock_global_vars, [
      layer0,
      layer1
    ])
    const layer3 = generate_layerdeployment(mockConfig, 3, mock_global_vars, [
      layer0,
      layer1,
      layer2
    ])
    const layer4 = generate_layerdeployment(mockConfig, 4, mock_global_vars, [
      layer0,
      layer1,
      layer2,
      layer3
    ])
    const result = generate_layerdeployment(mockConfig, 5, mock_global_vars, [
      layer0,
      layer1,
      layer2,
      layer3,
      layer4
    ])
    expect(result).toEqual([])
  })
})
