import{t as e}from"./shaderStore-bQ-8n2dS.js";import"./sceneUboDeclaration-Bly86Rp5.js";import"./meshUboDeclaration-B0kqgl_n.js";var t=`volumetricLightingRenderVolumeVertexShader`,n=`#include<sceneUboDeclaration>
#include<meshUboDeclaration>
attribute position : vec3f;varying vWorldPos: vec4f;@vertex
fn main(input : VertexInputs)->FragmentInputs {let worldPos=mesh.world*vec4f(vertexInputs.position,1.0);vertexOutputs.vWorldPos=worldPos;vertexOutputs.position=scene.viewProjection*worldPos;}
`;e.ShadersStoreWGSL[t]||(e.ShadersStoreWGSL[t]=n);var r={name:t,shader:n};export{r as volumetricLightingRenderVolumeVertexShaderWGSL};