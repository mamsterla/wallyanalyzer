export const hardDeletePsiuRequest=(id:string)=>({path:`/v1/admin/psiu-units/${id}`,method:'DELETE' as const});
