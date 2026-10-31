// Bench-only: a keeper drawn on the frozen rig as nested groups (one per bone and socket), re-posed every frame from the
// routine's pose. It uses the production avatar mesher and clay; coat tails go through main's citizen cape renderer.
// Production code never imports this module.
import * as THREE from 'three';
import { AvatarAttachmentIdSchema } from '@chatdom/shared';
import { geometryFromChunks } from '@chatdom/render';
import { MATERIALS } from '../../materials';
import { attachmentBind, attachmentLocalMatrix, compileAvatarPart, partPivotMatrix, restPosition } from '../../avatars/index';

/** Build a keeper's rig groups and meshes. `set(pose, tool)` re-poses it and shows only the tool in hand. */
export async function createKeeperFigure(pool, material, look) {
    const groups = new Map();
    for (const id of AvatarAttachmentIdSchema.options) {
        const group = new THREE.Group();
        group.name = id;
        group.matrixAutoUpdate = false;
        groups.set(id, group);
    }
    for (const [id, group] of groups)
        if (id !== 'root')
            groups.get(attachmentBind(id).parent).add(group);
    const root = groups.get('root');
    const geometries = [];
    let triangles = 0;
    const meshPart = async (part) => {
        const result = await pool.submit({ kind: 'asset', asset: compileAvatarPart(part, 1), materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
        if (result?.kind !== 'asset' || !result.chunks.length)
            throw new Error(`No geometry for ${part.id}.`);
        const geometry = geometryFromChunks(result.chunks, 'avatar');
        geometries.push(geometry);
        triangles += result.chunks.reduce((n, chunk) => n + chunk.mesh.indices.length / 3, 0);
        const mesh = new THREE.Mesh(geometry, material.material);
        mesh.name = part.id;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(partPivotMatrix(part));
        groups.get(part.attachment).add(mesh);
        return mesh;
    };
    await Promise.all(look.parts.map(meshPart));
    const tools = new Map();
    for (const tool of look.tools)
        tools.set(tool.id, await Promise.all(tool.parts.map(meshPart)));
    return {
        root, attachments: groups, look,
        set(pose, tool) {
            for (const [id, group] of groups)
                group.matrix.fromArray(attachmentLocalMatrix(id, pose));
            for (const [id, meshes] of tools)
                for (const mesh of meshes)
                    mesh.visible = id === tool;
            root.updateMatrixWorld(true);
        },
        /** World position of a named tool point under the current pose. */
        toolPoint(toolId, point) {
            const found = look.tools.find(t => t.id === toolId)?.points[point];
            if (!found)
                throw new Error(`No point ${point} on ${toolId}.`);
            const local = new THREE.Vector3(...found.at).sub(new THREE.Vector3(...restPosition(found.attachment))).multiplyScalar(0.0625);
            return local.applyMatrix4(groups.get(found.attachment).matrixWorld);
        },
        get stats() { return { parts: look.parts.length, triangles }; },
        dispose() { for (const geometry of geometries) geometry.dispose(); root.removeFromParent(); },
    };
}
